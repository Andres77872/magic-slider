import { getPrimitive } from '../catalog/registry'
import type { Block } from '../catalog/types'
import type { Deck, Slide } from '../domain/deckSchema'
import { findSlide, locateBlock } from '../domain/tree'

/**
 * Chat references. The user points at slides and elements with `@<id>`
 * mentions ("update this image @hero-image and tighten @market-size"). Slide
 * and block ids are unique across a deck, so the id alone is an unambiguous
 * handle that the agent also sees in the deck context. The composer text is
 * the single source of truth: chips, highlighting and the request payload are
 * all derived from the mentions it contains.
 */

export type ReferenceKind = 'slide' | 'block'

export interface ResolvedReference {
  id: string
  kind: ReferenceKind
  slideId: string
  slideIndex: number
  /** "slide" or the block's primitive type. */
  type: string
  /** Human label: "Slide 3 · Market size" or "image · Offshore wind turbines". */
  label: string
}

/** What a sent message keeps about each reference, so history still reads well after edits. */
export interface ReferenceSnapshot {
  id: string
  kind: ReferenceKind
  slideId: string
  type: string
  label: string
}

/** `@id` not preceded by a word character, "@" or "." (so e-mail addresses are ignored). */
export const MENTION_PATTERN = /(?<![\p{L}\p{N}_@.])@([A-Za-z0-9][A-Za-z0-9_-]{0,63})/gu

export interface MentionRange {
  id: string
  /** Index of the "@". */
  start: number
  /** Index after the id. */
  end: number
}

export function mentionRanges(text: string): MentionRange[] {
  const ranges: MentionRange[] = []
  for (const match of text.matchAll(MENTION_PATTERN)) {
    // A trailing "-" or "_" is almost always punctuation, not part of the id.
    const id = match[1].replace(/[-_]+$/, '')
    if (!id) continue
    ranges.push({ id, start: match.index, end: match.index + 1 + id.length })
  }
  return ranges
}

/** Unique mentioned ids in order of first appearance. */
export function extractMentionIds(text: string): string[] {
  return [...new Set(mentionRanges(text).map((range) => range.id))]
}

function truncate(text: string, max: number): string {
  const clean = text.replace(/\s+/g, ' ').trim()
  return clean.length <= max ? clean : `${clean.slice(0, max - 1)}…`
}

export function slideLabel(slide: Pick<Slide, 'id' | 'name'>, index: number): string {
  return `Slide ${index + 1}${slide.name ? ` · ${truncate(slide.name, 40)}` : ''}`
}

export function blockLabel(block: Block): string {
  const primitive = getPrimitive(block.type)
  const outline = primitive?.outline ? primitive.outline(block as never) : ''
  return outline ? `${block.type} · ${truncate(outline, 42)}` : `${block.type} ${block.id ?? ''}`.trim()
}

export function resolveReference(deck: Pick<Deck, 'slides'>, id: string): ResolvedReference | null {
  const slide = findSlide(deck, id)
  if (slide) return { id, kind: 'slide', slideId: id, slideIndex: slide.index, type: 'slide', label: slideLabel(slide.slide, slide.index) }
  const located = locateBlock(deck, id)
  if (!located) return null
  return { id, kind: 'block', slideId: located.slide.id, slideIndex: located.slideIndex, type: located.block.type, label: blockLabel(located.block) }
}

export function resolveMentions(deck: Pick<Deck, 'slides'> | null, text: string): { resolved: ResolvedReference[]; missing: string[] } {
  const resolved: ResolvedReference[] = []
  const missing: string[] = []
  for (const id of extractMentionIds(text)) {
    const reference = deck ? resolveReference(deck, id) : null
    if (reference) resolved.push(reference)
    else missing.push(id)
  }
  return { resolved, missing }
}

export function snapshotReference(reference: ResolvedReference): ReferenceSnapshot {
  return { id: reference.id, kind: reference.kind, slideId: reference.slideId, type: reference.type, label: reference.label }
}

/* ---------- agent payload ---------- */

export const REFERENCE_BLOCK_MAX_CHARS = 4_000
export const REFERENCE_SLIDE_MAX_CHARS = 8_000
export const REFERENCES_MAX_CHARS = 16_000

function clip(json: string, max: number): string {
  return json.length <= max ? json : `${json.slice(0, max - 14)}… [truncated]`
}

/**
 * The "Referenced items" section of the system message: every item the user
 * mentioned, in full, so the agent edits exactly what was pointed at.
 */
export function formatReferencesContext(deck: Pick<Deck, 'slides'>, ids: readonly string[]): string | null {
  if (!ids.length) return null
  const lines = [
    'Referenced items (the user attached these with @mentions; "@<id>" in the request means the item listed here. Apply the request to exactly these items, address them by these ids, and keep everything else unchanged).',
  ]
  let budget = REFERENCES_MAX_CHARS - lines[0].length
  for (const id of ids) {
    const reference = resolveReference(deck, id)
    let line: string
    if (!reference) {
      line = `- @${id} → not found in the current presentation (it may have been deleted); ask the user if the request depends on it.`
    } else if (reference.kind === 'slide') {
      const slide = deck.slides[reference.slideIndex]
      line = `- @${id} → slide ${reference.slideIndex + 1}${slide.name ? ` "${slide.name}"` : ''}: ${clip(JSON.stringify(slide), Math.min(REFERENCE_SLIDE_MAX_CHARS, Math.max(budget - 80, 200)))}`
    } else {
      const block = locateBlock(deck, id)!.block
      line = `- @${id} → ${reference.type} block on slide "${reference.slideId}" (slide ${reference.slideIndex + 1}): ${clip(JSON.stringify(block), Math.min(REFERENCE_BLOCK_MAX_CHARS, Math.max(budget - 80, 200)))}`
    }
    if (line.length > budget) {
      lines.push(`- (${ids.length - lines.length + 1} more referenced item(s) omitted for length; they are in the Current presentation above.)`)
      break
    }
    budget -= line.length + 1
    lines.push(line)
  }
  return lines.join('\n')
}

/* ---------- composer helpers ---------- */

/** The mention being typed at the caret: "@" start index and the query after it. */
export function activeMentionQuery(text: string, caret: number): { start: number; query: string } | null {
  const before = text.slice(0, caret)
  const match = /(?:^|[\s([{,;:"'])@([A-Za-z0-9_-]{0,64})$/.exec(before)
  if (!match) return null
  return { start: caret - match[1].length - 1, query: match[1] }
}

/** Replaces the mention being typed (or inserts at the caret) with "@id ". */
export function insertMention(text: string, caret: number, id: string, replaceFrom?: number): { text: string; caret: number } {
  const start = replaceFrom ?? caret
  const before = text.slice(0, start)
  const after = text.slice(caret)
  const needsSpaceBefore = before.length > 0 && !/[\s([{]$/.test(before)
  const token = `${needsSpaceBefore ? ' ' : ''}@${id}`
  const spacer = after.startsWith(' ') ? '' : ' '
  const next = `${before}${token}${spacer}${after}`
  return { text: next, caret: before.length + token.length + spacer.length }
}

/** Removes every mention of an id, tidying the whitespace it leaves behind. */
export function removeMention(text: string, id: string): string {
  let result = ''
  let cursor = 0
  for (const range of mentionRanges(text)) {
    if (range.id !== id) continue
    result += text.slice(cursor, range.start)
    cursor = range.end
  }
  result += text.slice(cursor)
  return result.replace(/[ \t]{2,}/g, ' ').replace(/ +([,.;:!?])/g, '$1').trim()
}

export interface MentionSuggestion extends ResolvedReference {
  /** Nesting depth for blocks (0 = slide root); -1 for slides. */
  depth: number
  /** Whether the item is on the slide the user is viewing. */
  onActiveSlide: boolean
}

function suggestionsFor(deck: Pick<Deck, 'slides'>, activeSlideId: string | null): MentionSuggestion[] {
  const items: MentionSuggestion[] = []
  const visit = (blocks: readonly Block[], slide: Slide, slideIndex: number, depth: number) => {
    for (const block of blocks) {
      if (!block.id) continue
      items.push({ id: block.id, kind: 'block', slideId: slide.id, slideIndex, type: block.type, label: blockLabel(block), depth, onActiveSlide: slide.id === activeSlideId })
      if (block.children?.length) visit(block.children, slide, slideIndex, depth + 1)
    }
  }
  deck.slides.forEach((slide, slideIndex) => {
    items.push({ id: slide.id, kind: 'slide', slideId: slide.id, slideIndex, type: 'slide', label: slideLabel(slide, slideIndex), depth: -1, onActiveSlide: slide.id === activeSlideId })
    visit(slide.blocks, slide, slideIndex, 0)
  })
  return items
}

/**
 * Ranked suggestions for the @ popover. With no query: the active slide and
 * its elements, then the other slides. With a query: anything whose id, type,
 * label or slide number matches, preferring id prefixes and the active slide.
 */
export function mentionSuggestions(deck: Pick<Deck, 'slides'>, query: string, activeSlideId: string | null, limit = 40): MentionSuggestion[] {
  const all = suggestionsFor(deck, activeSlideId)
  const needle = query.trim().toLowerCase()
  if (!needle) {
    const active = all.filter((item) => item.onActiveSlide)
    const slides = all.filter((item) => item.kind === 'slide' && !item.onActiveSlide)
    return [...active, ...slides].slice(0, limit)
  }
  const slideNumber = /^(?:s|slide-?)?(\d{1,2})$/.exec(needle)?.[1]
  const scored: Array<{ item: MentionSuggestion; score: number; order: number }> = []
  all.forEach((item, order) => {
    const id = item.id.toLowerCase()
    const label = item.label.toLowerCase()
    let score = 0
    if (id === needle) score = 100
    else if (id.startsWith(needle)) score = 80
    else if (item.type.startsWith(needle)) score = 60
    else if (id.includes(needle)) score = 50
    else if (label.includes(needle)) score = 40
    if (slideNumber && item.kind === 'slide' && item.slideIndex + 1 === Number(slideNumber)) score = Math.max(score, 90)
    if (!score) return
    if (item.onActiveSlide) score += 5
    if (item.kind === 'slide') score += 2
    scored.push({ item, score, order })
  })
  return scored.sort((left, right) => right.score - left.score || left.order - right.order).slice(0, limit).map((entry) => entry.item)
}
