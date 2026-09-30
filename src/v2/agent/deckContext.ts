import { getPrimitive } from '../catalog/registry'
import type { Block } from '../catalog/types'
import type { Deck, Slide } from '../domain/deckSchema'

/**
 * The "Current presentation" system message: a compact, id-addressed view of
 * the deck so the agent can target edits precisely. Props are inlined as
 * compact JSON; when the deck is large, slides away from the focused one fall
 * back to a one-line outline per block.
 */

export const DECK_CONTEXT_MAX_CHARS = 18_000
const BLOCK_PROPS_MAX = 320
const FOCUSED_BLOCK_PROPS_MAX = 1_600

export interface DeckContextOptions {
  focusedSlideId?: string | null
  /** Content scale applied to fit each slide (1 = fits). */
  fitScales?: Readonly<Record<string, number>>
  maxChars?: number
}

function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 14)}… [truncated]`
}

function blockProps(block: Block): Record<string, unknown> {
  const props: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(block)) {
    if (key !== 'id' && key !== 'type' && key !== 'children') props[key] = value
  }
  return props
}

function blockLine(block: Block, depth: number, mode: 'props' | 'outline', max: number): string {
  const indent = '  '.repeat(depth)
  const head = `${indent}- ${block.id ?? '(no id)'} ${block.type}`
  if (mode === 'outline') {
    const primitive = getPrimitive(block.type)
    const outline = primitive?.outline ? primitive.outline(block as never) : ''
    return outline ? `${head}: ${truncate(outline.replace(/\s+/g, ' '), 110)}` : head
  }
  const props = blockProps(block)
  return Object.keys(props).length ? `${head} ${truncate(JSON.stringify(props), max)}` : head
}

function blockLines(blocks: readonly Block[], depth: number, mode: 'props' | 'outline', max: number, into: string[]): void {
  for (const block of blocks) {
    into.push(blockLine(block, depth, mode, max))
    if (block.children?.length) blockLines(block.children, depth + 1, mode, max, into)
  }
}

function slideHeader(slide: Slide, index: number, options: DeckContextOptions): string {
  const parts = [`## slide ${index + 1} · id ${slide.id}`]
  if (slide.name) parts.push(`name ${JSON.stringify(slide.name)}`)
  const fields: Record<string, unknown> = {}
  for (const key of ['align', 'tone', 'padding', 'gap', 'transition', 'autoAnimate', 'background'] as const) {
    if (slide[key] !== undefined) fields[key] = slide[key]
  }
  if (Object.keys(fields).length) parts.push(JSON.stringify(fields))
  const scale = options.fitScales?.[slide.id]
  if (scale !== undefined && scale < 0.97) parts.push(`content scaled to ${Math.round(scale * 100)}% to fit`)
  return parts.join(' · ')
}

function slideSection(slide: Slide, index: number, mode: 'props' | 'outline', options: DeckContextOptions): string {
  const focused = slide.id === options.focusedSlideId
  const lines = [slideHeader(slide, index, options)]
  blockLines(slide.blocks, 0, focused ? 'props' : mode, focused ? FOCUSED_BLOCK_PROPS_MAX : BLOCK_PROPS_MAX, lines)
  if (slide.notes) lines.push(`notes: ${truncate(slide.notes.replace(/\s+/g, ' '), focused ? 1_200 : mode === 'props' ? 280 : 90)}`)
  if (slide.sources?.length) {
    lines.push(mode === 'props' || focused
      ? `sources: ${JSON.stringify(slide.sources)}`
      : `sources: ${slide.sources.length} (${slide.sources.map((source) => source.title).join('; ').slice(0, 120)})`)
  }
  return lines.join('\n')
}

type Detail = 'props' | 'outline' | 'header'

function sectionAt(slide: Slide, index: number, detail: Detail, options: DeckContextOptions): string {
  if (detail === 'header') return slideHeader(slide, index, options)
  return slideSection(slide, index, detail, options)
}

/**
 * Every slide id always appears. The focused slide is rendered in full and
 * budgeted first; the others degrade from props to outline to a header line,
 * starting with the slides farthest from the focus, until the text fits.
 */
export function formatDeckContext(deck: Deck, options: DeckContextOptions = {}): string {
  const maxChars = options.maxChars ?? DECK_CONTEXT_MAX_CHARS
  const focusIndex = deck.slides.findIndex((slide) => slide.id === options.focusedSlideId)
  const overflow = deck.slides.filter((slide) => (options.fitScales?.[slide.id] ?? 1) < 0.9).map((slide) => slide.id)
  const header = [
    'Current presentation (authoritative; edit it with edit_presentation using these slide and block ids; values ending in "… [truncated]" are shortened here, so never copy them into an operation).',
    `meta: ${JSON.stringify({ title: deck.title, language: deck.language, theme: deck.theme, settings: deck.settings })}`,
    `slideCount: ${deck.slides.length}`,
    focusIndex >= 0 ? `Focused slide: ${deck.slides[focusIndex].id} (slide ${focusIndex + 1}) — the user is looking at it; "this slide" means it.` : null,
    overflow.length ? `Layout feedback: ${overflow.join(', ')} had to be scaled down to fit the 16:9 canvas. When editing those slides, tighten text or split content.` : null,
  ].filter(Boolean).join('\n')

  const details: Detail[] = deck.slides.map(() => 'props')
  const render = () => [header, ...deck.slides.map((slide, index) => sectionAt(slide, index, details[index], options))].join('\n\n')
  let text = render()
  if (text.length <= maxChars) return text

  // Degrade the slides farthest from the focus first; the focused slide keeps full detail.
  const anchor = focusIndex >= 0 ? focusIndex : 0
  const order = deck.slides.map((_, index) => index)
    .filter((index) => index !== focusIndex)
    .sort((left, right) => Math.abs(right - anchor) - Math.abs(left - anchor))
  for (const level of ['outline', 'header'] as const) {
    const note = `\n\n(Some slides are listed as ${level === 'outline' ? 'outlines' : 'headers only'} to fit; outlined slides still list every block id. Ask the user or use replace_slide only when a slide's details are needed.)`
    for (const index of order) {
      details[index] = level
      text = render()
      if (text.length + note.length <= maxChars) return `${text}${note}`
    }
  }
  // Even header-only is too long: keep every slide id, trimming the focused slide last.
  return truncate(text, maxChars)
}

/** Models do not know today's date; research for "latest" or "current" topics depends on it. */
export function clientContextLine(now: Date = new Date()): string {
  const date = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
  let zone: string
  try {
    zone = Intl.DateTimeFormat().resolvedOptions().timeZone
  } catch {
    zone = ''
  }
  return `Client context: today is ${date}${zone ? ` (${zone})` : ''}. Interpret "latest", "current" and relative dates from this date. Renderer: Magic Slider v2 primitives.`
}
