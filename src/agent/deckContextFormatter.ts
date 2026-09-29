import type { ValidatedPresentationConfig, ValidatedSlide } from '../domain/presentationTypes'

export const DECK_CONTEXT_MAX_CHARS = 12_000
export const DECK_CONTEXT_FIELD_MAX_CHARS = 700

export const STRUCTURED_TEXT_MAX_CHARS = 300

const TRUNCATION_SUFFIX = '… [truncated]'
const DECK_TRUNCATION_NOTICE = '[Deck content truncated: every slide index/title is listed; edit only fields requested by the user.]'
const TRUNCATED_VALUE_RULE = 'Values ending in "… [truncated]" or omitted here are shortened for context: never copy them into an action. Leave such fields unchanged, or rewrite the whole field from the user request.'
const STRUCTURED_FIELDS = ['stats', 'columns', 'timeline', 'quote', 'code', 'image', 'sources'] as const

function truncateField(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined
  const serialized = typeof value === 'string' ? value : JSON.stringify(value)
  if (!serialized) return undefined
  if (serialized.length <= DECK_CONTEXT_FIELD_MAX_CHARS) return serialized
  return `${serialized.slice(0, DECK_CONTEXT_FIELD_MAX_CHARS - TRUNCATION_SUFFIX.length)}${TRUNCATION_SUFFIX}`
}

function formatAttributes(attributes: ValidatedSlide['attributes']): string | undefined {
  if (!attributes) return undefined
  const entries = Object.entries(attributes).sort(([left], [right]) => left.localeCompare(right))
  if (entries.length === 0) return undefined
  return entries.map(([key, value]) => `${key}=${JSON.stringify(truncateField(value))}`).join(', ')
}

function truncateText(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - TRUNCATION_SUFFIX.length)}${TRUNCATION_SUFFIX}`
}

/** Shortens long strings inside structured fields without breaking their JSON or any URL. */
function boundStructured(value: unknown, key?: string): unknown {
  if (typeof value === 'string') return key === 'url' ? value : truncateText(value, STRUCTURED_TEXT_MAX_CHARS)
  if (Array.isArray(value)) return value.map((item) => boundStructured(item))
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([entryKey, entry]) => [entryKey, boundStructured(entry, entryKey)]))
  }
  return value
}

function formatSlide(slide: ValidatedSlide, index: number): string {
  const lines = [`- slideIndex: ${index}`]
  const textFields: Array<[string, string | undefined]> = [
    ['layout', slide.layout],
    ['kicker', slide.kicker],
    ['title', slide.title],
    ['subtitle', slide.subtitle],
    ['content', slide.content],
  ]
  for (const [name, value] of textFields) {
    const text = truncateField(value)
    if (text) lines.push(`  ${name}: ${text}`)
  }
  for (const name of STRUCTURED_FIELDS) {
    if (slide[name] !== undefined) lines.push(`  ${name}: ${JSON.stringify(boundStructured(slide[name]))}`)
  }
  // URLs are never shortened: a partial URL copied into an action would break the image.
  if (slide.backgroundImage) lines.push(`  backgroundImage: ${slide.backgroundImage}`)
  if (slide.background) lines.push(`  background: ${slide.background}`)
  if (slide.fragments !== undefined) lines.push(`  fragments: ${slide.fragments}`)
  const notes = truncateField(slide.notes)
  if (notes) lines.push(`  notes: ${notes}`)
  const attributes = formatAttributes(slide.attributes)
  if (attributes) lines.push(`  attributes: ${attributes}`)

  return lines.join('\n')
}

function fieldInventory(slide: ValidatedSlide): string {
  const fields: string[] = []
  for (const name of ['kicker', 'subtitle', 'content', 'notes', 'backgroundImage', 'background', 'image', 'quote', 'code', 'fragments', 'attributes'] as const) {
    if (slide[name] !== undefined) fields.push(name)
  }
  for (const name of ['stats', 'columns', 'timeline', 'sources'] as const) {
    const items = slide[name]
    if (items) fields.push(`${name}×${items.length}`)
  }
  return fields.join(', ') || 'none'
}

function formatRecord(record: Record<string, unknown> | undefined): string | undefined {
  if (!record || Object.keys(record).length === 0) return undefined
  return Object.entries(record)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}: ${truncateField(value)}`)
    .join(', ')
}

function buildHeader(deckState: ValidatedPresentationConfig): string[] {
  const lines = [
    'Current validated deck context for the presentation agent.',
    `slideCount: ${deckState.slides.length}`,
    'Action targeting: use zero-based slideIndex, afterIndex, fromIndex, and toIndex values for edit_slide, add_slide, delete_slide, and reorder_slides.',
    'Users number slides from 1: "slide 3" is slideIndex 2 and "after slide 3" is afterIndex 2.',
    'Prefer incremental edit_slide, add_slide, delete_slide, or reorder_slides actions when the user asks to modify this current deck; when an apply_changes tool is available, send all of them in one apply_changes call.',
    'Use update_deck for deck-level settings such as theme, title, language, plugins, or revealOptions. In edit_slide, a null field value removes that field.',
    'Use create_deck only when the user explicitly asks for a completely new deck or there is no current deck.',
    TRUNCATED_VALUE_RULE,
  ]

  if (deckState.title) lines.push(`title: ${truncateField(deckState.title)}`)
  if (deckState.language) lines.push(`language: ${deckState.language}`)
  if (deckState.theme) lines.push(`theme: ${deckState.theme}`)

  if (deckState.plugins?.length) lines.push(`plugins: ${[...new Set(deckState.plugins)].join(', ')}`)
  const revealOptions = formatRecord(deckState.revealOptions)
  if (revealOptions) lines.push(`revealOptions: ${revealOptions}`)
  lines.push('slides:')

  return lines
}

export function formatDeckContext(deckState: ValidatedPresentationConfig): string | null {
  if (!deckState.slides.length) return null

  const header = buildHeader(deckState).join('\n')
  const slideSummaries = deckState.slides.map(formatSlide)
  const fullContext = [header, ...slideSummaries].join('\n')
  if (fullContext.length <= DECK_CONTEXT_MAX_CHARS) return fullContext

  // Reserve space for every slide before adding detail. A greedy prefix drops
  // later slides, making requests such as "edit the conclusion" impossible to
  // target reliably even though slideCount claims those slides exist.
  const inventoryBudget = DECK_CONTEXT_MAX_CHARS - header.length - DECK_TRUNCATION_NOTICE.length - 3
  const lineBudget = Math.floor(inventoryBudget / deckState.slides.length)
  const inventory = deckState.slides.map((slide, index) => {
    const prefix = `- slideIndex: ${index}; title: `
    const suffix = `; layout: ${slide.layout ?? 'content'}; fields: ${fieldInventory(slide)}`
    const boundedSuffix = suffix.length <= lineBudget / 2 ? suffix : ''
    const title = (slide.title || '(untitled)').replace(/\s+/g, ' ')
    const limit = Math.max(0, Math.min(120, lineBudget - prefix.length - boundedSuffix.length - 1))
    const boundedTitle = title.length <= limit ? title : `${title.slice(0, Math.max(0, limit - 1))}…`
    return `${prefix}${boundedTitle}${boundedSuffix}`
  })
  const inventoryText = [header, ...inventory, DECK_TRUNCATION_NOTICE].join('\n')
  const remaining = DECK_CONTEXT_MAX_CHARS - inventoryText.length
  const detailPrefix = '\nSlide details (shortened):\n'
  const perSlide = Math.floor((remaining - detailPrefix.length) / deckState.slides.length) - 1
  if (perSlide < 40) return inventoryText

  const details = deckState.slides.map((slide, index) => {
    const text = formatSlide(slide, index).split('\n').map((line) => line.trim()).join(' | ').replace(/\s+/g, ' ')
    return truncateText(text, perSlide)
  })
  return inventoryText + detailPrefix + details.join('\n')
}
