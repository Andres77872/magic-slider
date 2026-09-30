import { z } from 'zod'

import { BLOCK_ID_PATTERN, MAX_BLOCK_DEPTH, MAX_BLOCKS_PER_SLIDE, MAX_CHILDREN } from '../catalog/registry'
import type { Block } from '../catalog/types'
import { MAX_SLIDES, MAX_TOP_LEVEL_BLOCKS, deckMetaShape, type Deck, type Slide } from './deckSchema'
import {
  normalizeBlocksForSlide, normalizeDeck, normalizeSlideForDeck, type DeckDiagnostic,
} from './normalize'
import { repairWithSchema } from './repair'

/**
 * Edit operations address slides and blocks by stable id, never by position,
 * so a sequence of edits stays correct while earlier edits move things around.
 * Operations apply one at a time: a failed operation is reported and skipped,
 * the others still apply, and the user can undo the whole turn.
 */

const id = z.string().min(1).max(64)
/** Where to place a slide: after this slide id, "start", or null for the beginning; omitted appends. */
const anchor = z.union([id, z.null(), z.number().int()])
const looseRecord = z.record(z.string(), z.unknown())

export const operationSchema = z.discriminatedUnion('op', [
  z.object({ op: z.literal('add_slides'), after: anchor.optional(), slides: z.array(z.unknown()).min(1).max(20) }),
  z.object({ op: z.literal('replace_slide'), slideId: id, slide: looseRecord }),
  z.object({ op: z.literal('update_slide'), slideId: id, set: looseRecord }),
  z.object({ op: z.literal('remove_slides'), slideIds: z.array(id).min(1).max(MAX_SLIDES) }),
  z.object({ op: z.literal('move_slide'), slideId: id, after: anchor }),
  z.object({ op: z.literal('duplicate_slide'), slideId: id, after: anchor.optional() }),
  z.object({ op: z.literal('update_block'), blockId: id, slideId: id.optional(), set: looseRecord }),
  z.object({ op: z.literal('replace_block'), blockId: id, slideId: id.optional(), block: z.unknown() }),
  z.object({ op: z.literal('duplicate_block'), blockId: id, slideId: id.optional() }),
  z.object({ op: z.literal('insert_blocks'), slideId: id, parentId: id.nullable().optional(), index: z.number().int().min(0).optional(), blocks: z.array(z.unknown()).min(1).max(24) }),
  z.object({ op: z.literal('remove_blocks'), blockIds: z.array(id).min(1).max(120), slideId: id.optional() }),
  z.object({ op: z.literal('move_block'), blockId: id, slideId: id.optional(), toSlideId: id.optional(), parentId: id.nullable().optional(), index: z.number().int().min(0).optional() }),
  z.object({ op: z.literal('update_deck'), set: looseRecord }),
])

export type DeckOperation = z.infer<typeof operationSchema>
export const operationNames = operationSchema.options.map((option) => option.shape.op.value)

export interface ApplyResult {
  deck: Deck
  applied: DeckOperation[]
  failed: Array<{ operation: unknown; message: string }>
  diagnostics: DeckDiagnostic[]
}

class OperationError extends Error {}

function fail(message: string): never {
  throw new OperationError(message)
}

function findSlideIndex(deck: Deck, slideId: string): number {
  const index = deck.slides.findIndex((slide) => slide.id === slideId)
  if (index === -1) fail(`Slide "${slideId}" does not exist.`)
  return index
}

interface BlockLocation {
  slideIndex: number
  siblings: Block[]
  index: number
  parent: Block | null
  /** Nesting depth of the block itself: 0 for slide-root blocks. */
  depth: number
}

function locateBlock(deck: Deck, blockId: string, slideId?: string): BlockLocation {
  for (const [slideIndex, slide] of deck.slides.entries()) {
    if (slideId && slide.id !== slideId) continue
    const found = searchBlocks(slide.blocks, blockId, null)
    if (found) return { slideIndex, ...found }
  }
  if (slideId && deck.slides.some((slide) => slide.id === slideId)) {
    // A wrong slide hint should not block an otherwise unambiguous edit.
    return locateBlock(deck, blockId)
  }
  return fail(`Block "${blockId}" does not exist${slideId ? ` in slide "${slideId}"` : ''}.`)
}

function searchBlocks(blocks: Block[], blockId: string, parent: Block | null, depth = 0): Omit<BlockLocation, 'slideIndex'> | null {
  for (const [index, block] of blocks.entries()) {
    if (block.id === blockId) return { siblings: blocks, index, parent, depth }
    if (block.children) {
      const found = searchBlocks(block.children, blockId, block, depth + 1)
      if (found) return found
    }
  }
  return null
}

function countBlocks(blocks: readonly Block[]): number {
  return blocks.reduce((total, block) => total + 1 + (block.children ? countBlocks(block.children) : 0), 0)
}

function subtreeDepth(block: Block): number {
  return block.children?.length ? 1 + Math.max(...block.children.map(subtreeDepth)) : 0
}

/** Refuses an insertion that the deck limits would otherwise silently truncate. */
function assertCapacity(slide: Slide, siblings: readonly Block[], parentDepth: number | null, incoming: readonly Block[], movingWithinSlide = 0): void {
  const limit = parentDepth === null ? MAX_TOP_LEVEL_BLOCKS : MAX_CHILDREN
  if (siblings.length + incoming.length > limit) fail(`That container is full (at most ${limit} blocks).`)
  if (countBlocks(slide.blocks) - movingWithinSlide + countBlocks(incoming) > MAX_BLOCKS_PER_SLIDE) fail(`A slide holds at most ${MAX_BLOCKS_PER_SLIDE} blocks.`)
  const baseDepth = parentDepth === null ? 0 : parentDepth + 1
  if (incoming.some((block) => baseDepth + subtreeDepth(block) > MAX_BLOCK_DEPTH)) fail(`Blocks can nest at most ${MAX_BLOCK_DEPTH} levels deep.`)
}

function anchorIndex(deck: Deck, after: string | number | null | undefined): number {
  if (after === undefined) return deck.slides.length
  if (after === null || after === 'start') return 0
  if (typeof after === 'number') return Math.min(Math.max(after + 1, 0), deck.slides.length)
  return findSlideIndex(deck, after) + 1
}

function mergeSet(target: Record<string, unknown>, set: Record<string, unknown>, protectedKeys: string[]): Record<string, unknown> {
  const next = { ...target }
  for (const [key, value] of Object.entries(set)) {
    if (protectedKeys.includes(key)) continue
    if (value === null) delete next[key]
    else next[key] = value
  }
  return next
}

function blockIdsIn(blocks: readonly Block[], into = new Set<string>()): Set<string> {
  for (const block of blocks) {
    if (block.id) into.add(block.id)
    if (block.children) blockIdsIn(block.children, into)
  }
  return into
}

/** A copy of the deck with one block subtree removed, used to free its ids for re-validation. */
function withoutBlock(deck: Deck, location: BlockLocation): Deck {
  const clone = structuredClone(deck)
  const target = clone.slides[location.slideIndex]
  const found = searchBlocks(target.blocks, location.siblings[location.index].id!, null)
  found?.siblings.splice(found.index, 1)
  return clone
}

function renumberCopy(slide: Slide, deck: Deck): Slide {
  const copy = structuredClone(slide) as unknown as Record<string, unknown>
  delete copy.id
  const strip = (blocks: unknown): void => {
    if (!Array.isArray(blocks)) return
    for (const block of blocks as Array<Record<string, unknown>>) {
      delete block.id
      strip(block.children)
    }
  }
  strip(copy.blocks)
  const { slide: normalized } = normalizeSlideForDeck(copy, deck, 'duplicate')
  if (!normalized) fail('The slide could not be duplicated.')
  return normalized
}

function applyOne(deck: Deck, operation: DeckOperation, diagnostics: DeckDiagnostic[]): Deck {
  const next = structuredClone(deck)
  const collect = (items: DeckDiagnostic[]) => diagnostics.push(...items)

  switch (operation.op) {
    case 'add_slides': {
      let insertAt = anchorIndex(next, operation.after)
      if (next.slides.length + operation.slides.length > MAX_SLIDES) fail(`A deck holds at most ${MAX_SLIDES} slides.`)
      for (const [offset, raw] of operation.slides.entries()) {
        const { slide, diagnostics: slideDiagnostics } = normalizeSlideForDeck(raw, next, `add_slides.${offset}`)
        collect(slideDiagnostics)
        if (!slide) continue
        next.slides.splice(insertAt, 0, slide)
        insertAt += 1
      }
      return next
    }
    case 'replace_slide': {
      const index = findSlideIndex(next, operation.slideId)
      const { slide, diagnostics: slideDiagnostics } = normalizeSlideForDeck(operation.slide, next, `replace_slide.${operation.slideId}`, operation.slideId)
      collect(slideDiagnostics)
      if (!slide) fail(`Slide "${operation.slideId}" could not be replaced with invalid content.`)
      next.slides[index] = slide
      return next
    }
    case 'update_slide': {
      const index = findSlideIndex(next, operation.slideId)
      const merged = mergeSet(next.slides[index] as unknown as Record<string, unknown>, operation.set, ['id'])
      if (!Array.isArray(merged.blocks)) merged.blocks = []
      const { slide, diagnostics: slideDiagnostics } = normalizeSlideForDeck(merged, next, `update_slide.${operation.slideId}`, operation.slideId)
      collect(slideDiagnostics)
      if (!slide) fail(`Slide "${operation.slideId}" could not be updated.`)
      next.slides[index] = slide
      return next
    }
    case 'remove_slides': {
      const remove = new Set(operation.slideIds)
      for (const slideId of remove) findSlideIndex(next, slideId)
      const remaining = next.slides.filter((slide) => !remove.has(slide.id))
      if (!remaining.length) fail('A deck must keep at least one slide.')
      next.slides = remaining
      return next
    }
    case 'move_slide': {
      const from = findSlideIndex(next, operation.slideId)
      if (operation.after === operation.slideId) return next
      const [slide] = next.slides.splice(from, 1)
      const to = anchorIndex(next, operation.after)
      next.slides.splice(to, 0, slide)
      return next
    }
    case 'duplicate_slide': {
      const from = findSlideIndex(next, operation.slideId)
      const copy = renumberCopy(next.slides[from], next)
      const to = operation.after === undefined ? from + 1 : anchorIndex(next, operation.after)
      if (next.slides.length >= MAX_SLIDES) fail(`A deck holds at most ${MAX_SLIDES} slides.`)
      next.slides.splice(to, 0, copy)
      return next
    }
    case 'update_block':
    case 'replace_block': {
      const location = locateBlock(next, operation.blockId, operation.slideId)
      const current = location.siblings[location.index]
      const raw = operation.op === 'update_block'
        ? mergeSet(current, operation.set, ['id', 'type'])
        : { ...(operation.block && typeof operation.block === 'object' ? operation.block as Record<string, unknown> : { type: 'text', text: String(operation.block) }), id: current.id }
      const slide = next.slides[location.slideIndex]
      const { blocks, diagnostics: blockDiagnostics } = normalizeBlocksForSlide([raw], slide.id, withoutBlock(next, location), `${operation.op}.${operation.blockId}`, location.depth)
      collect(blockDiagnostics)
      if (!blocks.length) fail(`Block "${operation.blockId}" could not be ${operation.op === 'update_block' ? 'updated' : 'replaced'} with invalid content.`)
      location.siblings[location.index] = blocks[0]
      return next
    }
    case 'duplicate_block': {
      const location = locateBlock(next, operation.blockId, operation.slideId)
      const slide = next.slides[location.slideIndex]
      const copy = structuredClone(location.siblings[location.index]) as Record<string, unknown>
      const strip = (node: Record<string, unknown>) => {
        delete node.id
        delete node.morphId
        if (Array.isArray(node.children)) node.children.forEach((child) => strip(child as Record<string, unknown>))
      }
      strip(copy)
      const { blocks, diagnostics: blockDiagnostics } = normalizeBlocksForSlide([copy], slide.id, next, `duplicate_block.${operation.blockId}`, location.depth)
      collect(blockDiagnostics)
      if (!blocks.length) fail(`Block "${operation.blockId}" could not be duplicated.`)
      assertCapacity(slide, location.siblings, location.parent ? location.depth - 1 : null, blocks)
      location.siblings.splice(location.index + 1, 0, ...blocks)
      return next
    }
    case 'insert_blocks': {
      const slideIndex = findSlideIndex(next, operation.slideId)
      const slide = next.slides[slideIndex]
      let siblings = slide.blocks
      let parentDepth: number | null = null
      if (operation.parentId) {
        const location = locateBlock(next, operation.parentId, operation.slideId)
        const parent = location.siblings[location.index]
        if (!Array.isArray(parent.children)) fail(`Block "${operation.parentId}" is not a container (stack, grid or box).`)
        if (location.slideIndex !== slideIndex) fail(`Block "${operation.parentId}" is not on slide "${operation.slideId}".`)
        siblings = parent.children
        parentDepth = location.depth
      }
      const { blocks, diagnostics: blockDiagnostics } = normalizeBlocksForSlide(operation.blocks, slide.id, next, `insert_blocks.${operation.slideId}`, parentDepth === null ? 0 : parentDepth + 1)
      collect(blockDiagnostics)
      if (!blocks.length) fail('None of the inserted blocks were valid.')
      assertCapacity(slide, siblings, parentDepth, blocks)
      siblings.splice(Math.min(operation.index ?? siblings.length, siblings.length), 0, ...blocks)
      return next
    }
    case 'remove_blocks': {
      // Ids inside an already-removed subtree (or repeated ids) are satisfied, not errors.
      const removed = new Set<string>()
      const known = new Set<string>()
      for (const slide of next.slides) blockIdsIn(slide.blocks, known)
      for (const blockId of operation.blockIds) {
        if (removed.has(blockId)) continue
        if (!known.has(blockId)) fail(`Block "${blockId}" does not exist.`)
        const location = locateBlock(next, blockId, operation.slideId)
        const [block] = location.siblings.splice(location.index, 1)
        blockIdsIn([block], removed)
      }
      return next
    }
    case 'move_block': {
      const location = locateBlock(next, operation.blockId, operation.slideId)
      const block = location.siblings[location.index]
      const targetSlideIndex = findSlideIndex(next, operation.toSlideId ?? next.slides[location.slideIndex].id)
      const targetSlide = next.slides[targetSlideIndex]
      let siblings = targetSlide.blocks
      let parentDepth: number | null = null
      if (operation.parentId) {
        if (blockIdsIn([block]).has(operation.parentId)) fail('A block cannot move inside itself.')
        const parentLocation = locateBlock(next, operation.parentId, targetSlide.id)
        const parent = parentLocation.siblings[parentLocation.index]
        if (!Array.isArray(parent.children)) fail(`Block "${operation.parentId}" is not a container.`)
        siblings = parent.children
        parentDepth = parentLocation.depth
      }
      const sameList = siblings === location.siblings
      if (!sameList) assertCapacity(targetSlide, siblings, parentDepth, [block], targetSlideIndex === location.slideIndex ? countBlocks([block]) : 0)
      location.siblings.splice(location.index, 1)
      siblings.splice(Math.min(operation.index ?? siblings.length, siblings.length), 0, block)
      return next
    }
    case 'update_deck': {
      const { theme, settings, ...rest } = operation.set
      const merged: Record<string, unknown> = mergeSet({ title: next.title, language: next.language }, rest, [])
      if (theme !== undefined) {
        merged.theme = theme === null ? undefined : {
          ...next.theme,
          ...(typeof theme === 'string' ? { preset: theme } : theme as Record<string, unknown>),
          ...(theme && typeof theme === 'object' && (theme as Record<string, unknown>).colors
            ? { colors: { ...next.theme?.colors, ...(theme as { colors: Record<string, unknown> }).colors } }
            : {}),
          ...(theme && typeof theme === 'object' && (theme as Record<string, unknown>).fonts
            ? { fonts: { ...next.theme?.fonts, ...(theme as { fonts: Record<string, unknown> }).fonts } }
            : {}),
        }
        // Switching preset without new colors drops stale color overrides.
        if (theme && typeof theme === 'object' && 'preset' in theme && !('colors' in theme)) delete (merged.theme as Record<string, unknown>).colors
        if (typeof theme === 'string') delete (merged.theme as Record<string, unknown>).colors
      } else if (next.theme) {
        merged.theme = next.theme
      }
      if (settings !== undefined) merged.settings = settings === null ? undefined : { ...next.settings, ...(settings as Record<string, unknown>) }
      else if (next.settings) merged.settings = next.settings
      const result = repairWithSchema(z.strictObject(deckMetaShape), JSON.parse(JSON.stringify(merged)), { basePath: 'update_deck' })
      diagnostics.push(...result.notes.map((note) => ({ severity: 'info' as const, path: note.path, message: note.message })))
      if (!result.ok) fail(`Deck settings are invalid: ${result.message}`)
      return { ...next, title: undefined, language: undefined, theme: undefined, settings: undefined, ...result.data, version: 2, slides: next.slides }
    }
  }
}

/** Parses loose tool arguments into operations, accepting a few common envelope shapes. */
export function parseOperations(args: unknown): { operations: DeckOperation[]; failed: Array<{ operation: unknown; message: string }> } {
  const record = args && typeof args === 'object' ? args as Record<string, unknown> : {}
  const list = Array.isArray(args) ? args : Array.isArray(record.operations) ? record.operations : Array.isArray(record.changes) ? record.changes : Array.isArray(record.ops) ? record.ops : [args]
  const operations: DeckOperation[] = []
  const failed: Array<{ operation: unknown; message: string }> = []
  for (const raw of list) {
    const candidate = raw && typeof raw === 'object' && !('op' in raw) && 'action' in raw ? { ...raw, op: (raw as { action: unknown }).action } : raw
    const parsed = operationSchema.safeParse(candidate)
    if (parsed.success) operations.push(parsed.data)
    else failed.push({ operation: raw, message: parsed.error.issues.map((issue) => `${issue.path.join('.') || 'operation'}: ${issue.message}`).slice(0, 2).join('; ') })
  }
  return { operations, failed }
}

export function applyOperations(deck: Deck, operations: readonly DeckOperation[]): ApplyResult {
  let current = deck
  const applied: DeckOperation[] = []
  const failed: ApplyResult['failed'] = []
  const diagnostics: DeckDiagnostic[] = []
  for (const operation of operations) {
    try {
      const opDiagnostics: DeckDiagnostic[] = []
      const next = applyOne(current, operation, opDiagnostics)
      // Every applied operation leaves a fully valid deck behind.
      const checked = normalizeDeck(next)
      if (!checked.deck) fail('The operation would leave the deck without valid slides.')
      const before = next.slides.reduce((total, slide) => total + countBlocks(slide.blocks), 0)
      const after = checked.deck.slides.reduce((total, slide) => total + countBlocks(slide.blocks), 0)
      if (checked.deck.slides.length < next.slides.length || after < before) {
        const reason = checked.diagnostics.find((diagnostic) => diagnostic.severity !== 'info')?.message ?? 'a deck limit was exceeded'
        fail(`The operation would drop existing content (${reason}).`)
      }
      current = checked.deck
      diagnostics.push(...opDiagnostics)
      applied.push(operation)
    } catch (error) {
      if (!(error instanceof OperationError)) throw error
      failed.push({ operation, message: error.message })
      diagnostics.push({ severity: 'error', path: operation.op, message: error.message })
    }
  }
  return { deck: current, applied, failed, diagnostics }
}

export function isValidId(value: string): boolean {
  return BLOCK_ID_PATTERN.test(value)
}
