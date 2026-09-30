import { BLOCK_ID_PATTERN, getPrimitive, isContainer } from '../catalog/registry'
import type { Block } from '../catalog/types'
import type { Deck, Slide } from './deckSchema'
import type { DeckOperation } from './operations'
import { findSlide, locateBlock, stripBlockIds, stripSlideIds, subtreeIds } from './tree'

/**
 * Pure builders that turn user intents from the studio UI into deck
 * operations. The UI never mutates a deck directly: it applies these through
 * applyOperations, the same path the agent uses, so validation, repair and
 * undo behave identically for manual and generated edits.
 */

export interface EditorCommand {
  operations: DeckOperation[]
  /** A short past-tense summary for the chat log and toasts. */
  summary: string
  /** What to select after the command applies. */
  select?: { slideId: string; blockId: string | null }
}

/** Where new content goes: the current slide and, optionally, the selected block. */
export interface InsertTarget {
  slideId: string
  blockId?: string | null
}

export function allIds(deck: Pick<Deck, 'slides'>): Set<string> {
  const ids = new Set<string>()
  for (const slide of deck.slides) {
    ids.add(slide.id)
    subtreeIds(slide.blocks, ids)
  }
  return ids
}

/** A readable id that no slide or block uses yet: "chart", "chart-2", … */
export function uniqueId(deck: Pick<Deck, 'slides'>, base: string, taken: Set<string> = allIds(deck)): string {
  const clean = base.toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^[-_]+|[-_]+$/g, '').slice(0, 48) || 'item'
  const stem = BLOCK_ID_PATTERN.test(clean) ? clean : `x-${clean}`.slice(0, 48)
  if (!taken.has(stem)) return stem
  for (let counter = 2; ; counter += 1) {
    const candidate = `${stem}-${counter}`
    if (!taken.has(candidate)) return candidate
  }
}

/** Resolves an insertion point: inside a selected container, after a selected block, or at the end of the slide. */
export function insertionPoint(deck: Deck, target: InsertTarget): { slideId: string; parentId: string | null; index?: number } {
  if (target.blockId) {
    const located = locateBlock(deck, target.blockId)
    if (located && located.slide.id === target.slideId) {
      if (isContainer(located.block)) return { slideId: target.slideId, parentId: located.block.id ?? null }
      return { slideId: target.slideId, parentId: located.parent?.id ?? null, index: located.index + 1 }
    }
  }
  return { slideId: target.slideId, parentId: null }
}

function insertBlocksCommand(deck: Deck, target: InsertTarget, blocks: Block[], summary: string): EditorCommand {
  const taken = allIds(deck)
  const prepared = blocks.map((block) => {
    const id = uniqueId(deck, block.type, taken)
    taken.add(id)
    return { ...stripBlockIds(block), id }
  })
  const point = insertionPoint(deck, target)
  return {
    operations: [{ op: 'insert_blocks', slideId: point.slideId, parentId: point.parentId, ...(point.index !== undefined ? { index: point.index } : {}), blocks: prepared }],
    summary,
    select: { slideId: target.slideId, blockId: prepared[prepared.length - 1].id },
  }
}

/** Same-origin placeholder, so inserted images render offline and export cleanly. */
export const PLACEHOLDER_IMAGE = '/placeholders/image.svg'

/** Catalog examples point at example.com media; inserted blocks start from something that renders. */
const insertOverrides: Record<string, Record<string, unknown>> = {
  image: { src: PLACEHOLDER_IMAGE, alt: 'Placeholder image', caption: undefined },
}

/** Inserts a primitive's catalog example as a starting point the user then edits. */
export function insertPrimitive(deck: Deck, target: InsertTarget, type: string): EditorCommand | null {
  const primitive = getPrimitive(type)
  if (!primitive) return null
  const block = { ...structuredClone(primitive.example), ...insertOverrides[type] }
  for (const [key, value] of Object.entries(block)) if (value === undefined) delete block[key]
  return insertBlocksCommand(deck, target, [block], `Inserted a ${type} block.`)
}

export function pasteBlocks(deck: Deck, target: InsertTarget, blocks: Block[]): EditorCommand | null {
  if (!blocks.length) return null
  return insertBlocksCommand(deck, target, blocks, blocks.length === 1 ? `Pasted a ${blocks[0].type} block.` : `Pasted ${blocks.length} blocks.`)
}

export function duplicateBlock(deck: Deck, blockId: string): EditorCommand | null {
  const located = locateBlock(deck, blockId)
  if (!located) return null
  const id = uniqueId(deck, `${located.block.type}`)
  return {
    operations: [{ op: 'insert_blocks', slideId: located.slide.id, parentId: located.parent?.id ?? null, index: located.index + 1, blocks: [{ ...stripBlockIds(located.block), id }] }],
    summary: `Duplicated ${located.block.type} ${blockId}.`,
    select: { slideId: located.slide.id, blockId: id },
  }
}

export function deleteBlock(deck: Deck, blockId: string): EditorCommand | null {
  const located = locateBlock(deck, blockId)
  if (!located) return null
  const neighbour = located.siblings[located.index + 1] ?? located.siblings[located.index - 1] ?? located.parent
  return {
    operations: [{ op: 'remove_blocks', blockIds: [blockId] }],
    summary: `Deleted ${located.block.type} ${blockId}.`,
    select: { slideId: located.slide.id, blockId: neighbour?.id ?? null },
  }
}

/**
 * Moves a block one step up or down among its siblings. At either end of a
 * container it steps out, before or after that container, so every position
 * stays reachable with the keyboard.
 */
export function moveBlockBy(deck: Deck, blockId: string, delta: -1 | 1): EditorCommand | null {
  const located = locateBlock(deck, blockId)
  if (!located) return null
  const { slide, parent, siblings, index, ancestors } = located
  const target = index + delta
  let operation: DeckOperation
  if (target >= 0 && target < siblings.length) {
    operation = { op: 'move_block', blockId, toSlideId: slide.id, parentId: parent?.id ?? null, index: target }
  } else if (parent) {
    const grandParent = ancestors[ancestors.length - 2] ?? null
    const outer = grandParent?.children ?? slide.blocks
    const parentIndex = outer.findIndex((block) => block.id === parent.id)
    operation = { op: 'move_block', blockId, toSlideId: slide.id, parentId: grandParent?.id ?? null, index: delta < 0 ? parentIndex : parentIndex + 1 }
  } else {
    return null
  }
  return { operations: [operation], summary: `Moved ${located.block.type} ${delta < 0 ? 'up' : 'down'}.`, select: { slideId: slide.id, blockId } }
}

export function setBlockProps(deck: Deck, blockId: string, set: Record<string, unknown>): EditorCommand | null {
  const located = locateBlock(deck, blockId)
  if (!located) return null
  const keys = Object.keys(set)
  return {
    operations: [{ op: 'update_block', blockId, slideId: located.slide.id, set }],
    summary: `Edited ${keys.length === 1 ? keys[0] : 'properties'} of ${located.block.type} ${blockId}.`,
    select: { slideId: located.slide.id, blockId },
  }
}

export function setSlideProps(deck: Deck, slideId: string, set: Record<string, unknown>): EditorCommand | null {
  const found = findSlide(deck, slideId)
  if (!found) return null
  const keys = Object.keys(set)
  return {
    operations: [{ op: 'update_slide', slideId, set }],
    summary: `Edited ${keys.length === 1 ? keys[0] : 'settings'} of slide ${found.index + 1}.`,
  }
}

export function setDeckProps(set: Record<string, unknown>, summary = 'Updated the presentation settings.'): EditorCommand {
  return { operations: [{ op: 'update_deck', set }], summary }
}

/** Adds a slide after another (null = at the beginning, undefined = at the end) and selects it. */
export function addSlide(deck: Deck, slide: Omit<Slide, 'id'> & { id?: string }, after: string | null | undefined, summary = 'Added a slide.'): EditorCommand {
  // Readable ids make better @mentions: "@text-and-image" rather than "@s7".
  const id = uniqueId(deck, slide.id ?? slide.name ?? 'slide')
  return {
    operations: [{ op: 'add_slides', ...(after !== undefined ? { after } : {}), slides: [{ ...slide, id }] }],
    summary,
    select: { slideId: id, blockId: null },
  }
}

export function duplicateSlide(deck: Deck, slideId: string): EditorCommand | null {
  const found = findSlide(deck, slideId)
  if (!found) return null
  return addSlide(deck, { ...stripSlideIds(found.slide), id: `${slideId}-copy` }, slideId, `Duplicated slide ${found.index + 1}.`)
}

export function pasteSlide(deck: Deck, slide: Slide, after: string | null | undefined): EditorCommand {
  return addSlide(deck, { ...stripSlideIds(slide), id: slide.id }, after, 'Pasted a slide.')
}

export function deleteSlide(deck: Deck, slideId: string): EditorCommand | null {
  const found = findSlide(deck, slideId)
  if (!found || deck.slides.length <= 1) return null
  const neighbour = deck.slides[found.index + 1] ?? deck.slides[found.index - 1]
  return {
    operations: [{ op: 'remove_slides', slideIds: [slideId] }],
    summary: `Deleted slide ${found.index + 1}.`,
    select: { slideId: neighbour.id, blockId: null },
  }
}

export function moveSlideBy(deck: Deck, slideId: string, delta: -1 | 1): EditorCommand | null {
  const found = findSlide(deck, slideId)
  if (!found) return null
  const target = found.index + delta
  if (target < 0 || target >= deck.slides.length) return null
  // move_slide places the slide after an anchor; null means the beginning.
  const remaining = deck.slides.filter((slide) => slide.id !== slideId)
  const after = target === 0 ? null : remaining[target - 1].id
  return {
    operations: [{ op: 'move_slide', slideId, after }],
    summary: `Moved slide ${found.index + 1} to position ${target + 1}.`,
    select: { slideId, blockId: null },
  }
}

/** Moves a slide so it lands at a target position (drag and drop). */
export function moveSlideTo(deck: Deck, slideId: string, targetIndex: number): EditorCommand | null {
  const found = findSlide(deck, slideId)
  if (!found || found.index === targetIndex) return null
  const remaining = deck.slides.filter((slide) => slide.id !== slideId)
  const clamped = Math.max(0, Math.min(targetIndex, remaining.length))
  const after = clamped === 0 ? null : remaining[clamped - 1].id
  return {
    operations: [{ op: 'move_slide', slideId, after }],
    summary: `Moved slide ${found.index + 1} to position ${clamped + 1}.`,
    select: { slideId, blockId: null },
  }
}
