import { z } from 'zod'

import {
  BLOCK_ID_PATTERN, MAX_BLOCK_DEPTH, MAX_BLOCKS_PER_SLIDE, MAX_CHILDREN, blockBaseKeys, blockBaseSchema, getPrimitive, primitivePropKeys,
} from '../catalog/registry'
import type { Block } from '../catalog/types'
import {
  DECK_VERSION, MAX_SLIDES, MAX_TOP_LEVEL_BLOCKS, deckMetaShape, slideShape, type Deck, type Slide,
} from './deckSchema'
import { repairWithSchema, type RepairNote } from './repair'

export type DiagnosticSeverity = 'info' | 'warning' | 'error'

export interface DeckDiagnostic {
  severity: DiagnosticSeverity
  path: string
  message: string
  slideId?: string
}

export interface NormalizeResult {
  deck: Deck | null
  diagnostics: DeckDiagnostic[]
}

/** Common names models use for primitives, mapped onto the catalog. */
const TYPE_ALIASES: Record<string, { type: string; props?: Record<string, unknown> }> = {
  paragraph: { type: 'text' },
  p: { type: 'text' },
  body: { type: 'text' },
  lead: { type: 'text', props: { variant: 'lead' } },
  subtitle: { type: 'text', props: { variant: 'lead' } },
  eyebrow: { type: 'text', props: { variant: 'eyebrow' } },
  kicker: { type: 'text', props: { variant: 'eyebrow' } },
  caption: { type: 'text', props: { variant: 'caption' } },
  title: { type: 'heading', props: { level: 1 } },
  h1: { type: 'heading', props: { level: 1 } },
  h2: { type: 'heading', props: { level: 2 } },
  h3: { type: 'heading', props: { level: 3 } },
  h4: { type: 'heading', props: { level: 4 } },
  bullets: { type: 'list' },
  bullet_list: { type: 'list' },
  ul: { type: 'list' },
  ol: { type: 'list', props: { style: 'number' } },
  checklist: { type: 'list', props: { style: 'check' } },
  img: { type: 'image' },
  picture: { type: 'image' },
  photo: { type: 'image' },
  metric: { type: 'stat' },
  kpi: { type: 'stat' },
  number: { type: 'stat' },
  row: { type: 'stack', props: { direction: 'horizontal' } },
  hstack: { type: 'stack', props: { direction: 'horizontal' } },
  vstack: { type: 'stack' },
  column: { type: 'stack' },
  group: { type: 'stack' },
  columns: { type: 'grid' },
  card: { type: 'box', props: { variant: 'card' } },
  panel: { type: 'box' },
  graph: { type: 'chart' },
  steps: { type: 'diagram', props: { kind: 'flow' } },
  process: { type: 'diagram', props: { kind: 'flow' } },
  hr: { type: 'divider' },
  separator: { type: 'divider' },
  tag: { type: 'badge' },
  chip: { type: 'badge' },
  pill: { type: 'badge' },
  note: { type: 'callout' },
  tip: { type: 'callout' },
  alert: { type: 'callout', props: { tone: 'warning' } },
  blockquote: { type: 'quote' },
  testimonial: { type: 'quote', props: { variant: 'card' } },
  person: { type: 'profile' },
  gauge: { type: 'progress', props: { variant: 'ring' } },
  roadmap: { type: 'timeline' },
}

/** Frequent prop-name slips, applied only when the target prop is absent. */
const PROP_ALIASES: Record<string, string[]> = {
  text: ['content', 'body', 'value', 'label', 'title'],
  src: ['url', 'image', 'href'],
  items: ['bullets', 'points', 'steps', 'nodes', 'entries'],
  children: ['blocks', 'content', 'items'],
  alt: ['description', 'caption'],
  attribution: ['author', 'by', 'source'],
  kind: ['chartType', 'variant', 'style'],
  labels: ['categories', 'xLabels'],
  label: ['title', 'caption', 'name'],
  name: ['icon'],
  source: ['code', 'content'],
}

const MAX_NOTES = 200

/**
 * Repairs an object against a shape; if the object as a whole cannot be
 * repaired, keeps every field that is valid on its own.
 */
function repairFields(shape: Record<string, z.ZodType>, input: Record<string, unknown>, basePath: string, context: NormalizeContext): Record<string, unknown> {
  const whole = repairWithSchema(z.strictObject(shape), input, { basePath })
  context.notes(whole.notes)
  if (whole.ok) return whole.data as Record<string, unknown>
  const kept: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(input)) {
    const field = shape[key]
    if (!field) continue
    const result = repairWithSchema(field, value, { basePath: basePath ? `${basePath}.${key}` : key })
    if (result.ok && result.data !== undefined) kept[key] = result.data
    else context.add('warning', basePath ? `${basePath}.${key}` : key, `Dropped an invalid ${key}.`)
  }
  return kept
}

class NormalizeContext {
  diagnostics: DeckDiagnostic[] = []
  slideIds = new Set<string>()
  blockIds = new Set<string>()
  slideId = ''
  blockCounter = 0
  blocksInSlide = 0

  add(severity: DiagnosticSeverity, path: string, message: string): void {
    if (this.diagnostics.length >= MAX_NOTES) return
    this.diagnostics.push({ severity, path, message, ...(this.slideId ? { slideId: this.slideId } : {}) })
  }

  notes(notes: RepairNote[], severity: DiagnosticSeverity = 'info'): void {
    for (const note of notes) this.add(severity, note.path, note.message)
  }

  nextBlockId(): string {
    let id: string
    do {
      this.blockCounter += 1
      id = `${this.slideId}-b${this.blockCounter}`
    } while (this.blockIds.has(id))
    return id
  }

  claimBlockId(candidate: unknown, path: string): string {
    if (typeof candidate === 'string' && BLOCK_ID_PATTERN.test(candidate) && !this.blockIds.has(candidate) && !this.slideIds.has(candidate)) {
      this.blockIds.add(candidate)
      return candidate
    }
    if (candidate !== undefined) this.add('info', path, 'Replaced a missing, invalid or duplicate block id.')
    const id = this.nextBlockId()
    this.blockIds.add(id)
    return id
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function applyAliases(raw: Record<string, unknown>, allowed: Set<string>, container: boolean): Record<string, unknown> {
  const next = { ...raw }
  for (const [target, sources] of Object.entries(PROP_ALIASES)) {
    const targetAllowed = target === 'children' ? container : allowed.has(target)
    if (!targetAllowed || next[target] !== undefined) continue
    for (const source of sources) {
      if (source === target || allowed.has(source)) continue
      if (next[source] !== undefined && !(target === 'children' && !Array.isArray(next[source]))) {
        next[target] = next[source]
        delete next[source]
        break
      }
    }
  }
  return next
}

function normalizeBlock(raw: unknown, path: string, context: NormalizeContext, depth: number): Block | null {
  if (typeof raw === 'string' && raw.trim()) raw = { type: 'text', text: raw }
  if (!isRecord(raw)) {
    context.add('warning', path, 'Skipped a block that is not an object.')
    return null
  }
  if (context.blocksInSlide >= MAX_BLOCKS_PER_SLIDE) {
    context.add('warning', path, `Skipped a block: slides hold at most ${MAX_BLOCKS_PER_SLIDE} blocks.`)
    return null
  }

  let type = typeof raw.type === 'string' ? raw.type.trim() : typeof raw.component === 'string' ? raw.component.trim() : ''
  let source: Record<string, unknown> = { ...raw }
  delete source.component
  if (isRecord(source.props)) {
    // json-render style { type, props: {...} } envelopes.
    source = { ...source, ...source.props }
    delete source.props
  }
  const lowerType = type.toLowerCase()
  let primitive = getPrimitive(type) ?? getPrimitive(lowerType)
  if (!primitive && TYPE_ALIASES[lowerType]) {
    const alias = TYPE_ALIASES[lowerType]
    primitive = getPrimitive(alias.type)
    source = { ...alias.props, ...source }
    context.add('info', path, `Read "${type}" as the ${alias.type} primitive.`)
  }
  if (!primitive) {
    context.add('warning', path, type ? `Skipped an unknown primitive "${type.slice(0, 40)}".` : 'Skipped a block without a type.')
    return null
  }
  type = primitive.type
  context.blocksInSlide += 1

  const propKeys = primitivePropKeys(primitive)
  const aliased = applyAliases(source, propKeys, Boolean(primitive.container))
  const baseInput: Record<string, unknown> = {}
  const propsInput: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(aliased)) {
    if (key === 'type' || key === 'children') continue
    if (blockBaseKeys.has(key)) baseInput[key] = value
    else if (propKeys.has(key)) propsInput[key] = value
    else context.add('info', `${path}.${key}`, `Dropped "${key.slice(0, 40)}", which ${type} does not support.`)
  }

  const id = context.claimBlockId(baseInput.id, `${path}.id`)
  delete baseInput.id
  const baseResult = repairWithSchema(blockBaseSchema, baseInput, { basePath: path })
  context.notes(baseResult.notes)

  const repairedProps = primitive.repair ? primitive.repair(propsInput, (message) => context.add('info', path, message)) : propsInput
  const propsResult = repairWithSchema(primitive.props, repairedProps, { basePath: path, required: requiredKeys(primitive.props) })
  context.notes(propsResult.notes)
  if (!propsResult.ok) {
    context.add('warning', path, `Skipped an invalid ${type} block: ${propsResult.message}`)
    context.blockIds.delete(id)
    return null
  }

  const block: Block = { type, id, ...(baseResult.ok ? baseResult.data : {}), ...(propsResult.data as Record<string, unknown>) }

  if (primitive.container) {
    const rawChildren = Array.isArray(aliased.children) ? aliased.children : aliased.children === undefined ? [] : [aliased.children]
    if (depth >= MAX_BLOCK_DEPTH) {
      if (rawChildren.length) context.add('warning', `${path}.children`, `Skipped nested blocks deeper than ${MAX_BLOCK_DEPTH} levels.`)
      block.children = []
    } else {
      if (rawChildren.length > MAX_CHILDREN) context.add('warning', `${path}.children`, `Kept the first ${MAX_CHILDREN} children.`)
      block.children = rawChildren.slice(0, MAX_CHILDREN)
        .map((child, index) => normalizeBlock(child, `${path}.children.${index}`, context, depth + 1))
        .filter((child): child is Block => child !== null)
    }
  }
  return block
}

const requiredKeyCache = new WeakMap<object, Set<string>>()

/** Top-level props a schema requires, so repair never drops them. */
function requiredKeys(schema: z.ZodType): Set<string> {
  const cached = requiredKeyCache.get(schema)
  if (cached) return cached
  const shape = (schema as unknown as { shape?: Record<string, z.ZodType> }).shape ?? {}
  const keys = new Set(Object.entries(shape).filter(([, field]) => !field.safeParse(undefined).success).map(([key]) => key))
  requiredKeyCache.set(schema, keys)
  return keys
}

export function normalizeBlocks(raw: unknown, path: string, context: NormalizeContext, depth = 0): Block[] {
  const list = Array.isArray(raw) ? raw : raw === undefined || raw === null ? [] : [raw]
  if (list.length > MAX_TOP_LEVEL_BLOCKS && depth === 0) {
    context.add('warning', path, `Kept the first ${MAX_TOP_LEVEL_BLOCKS} blocks.`)
  }
  return list.slice(0, depth === 0 ? MAX_TOP_LEVEL_BLOCKS : MAX_CHILDREN)
    .map((block, index) => normalizeBlock(block, `${path}.${index}`, context, depth))
    .filter((block): block is Block => block !== null)
}

const slideFieldsShape: Record<string, z.ZodType> = { ...slideShape, id: slideShape.id.optional() }

/** v1 content lines without the bullet or number markers v1 drew itself. */
function legacyLines(content: string): string[] {
  return content.split(/\r?\n/).map((line) => line.replace(/^\s*(?:[-*•▪◦–—]|\d{1,2}[.)])\s+/, '').trim()).filter(Boolean)
}

/** Converts a v1-style slide (title/content/stats/…) into primitive blocks. */
export function blocksFromLegacySlide(raw: Record<string, unknown>): unknown[] {
  const blocks: unknown[] = []
  const layout = typeof raw.layout === 'string' ? raw.layout : 'content'
  const hero = layout === 'title' || layout === 'closing' || layout === 'section' || layout === 'statement'
  if (typeof raw.kicker === 'string') blocks.push({ type: 'text', variant: 'eyebrow', text: raw.kicker, tone: 'accent' })
  if (typeof raw.title === 'string') blocks.push({ type: 'heading', text: raw.title, level: hero ? 1 : 2 })
  if (typeof raw.subtitle === 'string') blocks.push({ type: 'text', variant: 'lead', text: raw.subtitle, tone: 'muted' })
  if (typeof raw.content === 'string' && raw.content.trim()) {
    const lines = legacyLines(raw.content)
    if (lines.length > 1 && !hero) blocks.push({ type: 'list', items: lines.slice(0, 10), stagger: raw.fragments === true })
    else blocks.push({ type: 'text', text: lines.join('\n'), variant: hero ? 'lead' : 'body' })
  }
  if (Array.isArray(raw.stats)) {
    blocks.push({ type: 'grid', gap: 'lg', children: raw.stats.map((stat) => ({ type: 'stat', ...(isRecord(stat) ? stat : {}) })) })
  }
  if (Array.isArray(raw.columns)) {
    blocks.push({
      type: 'grid',
      children: raw.columns.map((column) => {
        if (!isRecord(column)) return null
        const lines = typeof column.content === 'string' ? legacyLines(column.content) : []
        return {
          type: 'box',
          children: [
            { type: 'heading', level: 3, text: column.heading },
            ...(lines.length > 1 ? [{ type: 'list', items: lines.slice(0, 10) }] : lines.length === 1 ? [{ type: 'text', text: lines[0] }] : []),
          ],
        }
      }).filter(Boolean),
    })
  }
  if (Array.isArray(raw.timeline)) {
    blocks.push({ type: 'timeline', items: raw.timeline.map((step) => (isRecord(step) ? { label: step.label, title: step.text } : step)) })
  }
  if (isRecord(raw.quote)) blocks.push({ type: 'quote', variant: 'large', text: raw.quote.text, attribution: raw.quote.attribution })
  if (isRecord(raw.code)) blocks.push({ type: 'code', source: raw.code.source, language: raw.code.language })
  if (isRecord(raw.image)) {
    const image = { type: 'image', src: raw.image.url, alt: raw.image.alt, caption: raw.image.caption, aspect: 'fill' }
    const text = blocks.splice(0)
    return raw.image.position === 'left'
      ? [{ type: 'grid', columns: '1fr 1fr', gap: 'xl', align: 'stretch', children: [image, { type: 'stack', justify: 'center', children: text }] }]
      : [{ type: 'grid', columns: '1fr 1fr', gap: 'xl', align: 'stretch', children: [{ type: 'stack', justify: 'center', children: text }, image] }]
  }
  return blocks
}

function legacySlideFields(raw: Record<string, unknown>): Record<string, unknown> {
  const layout = typeof raw.layout === 'string' ? raw.layout : undefined
  const background = typeof raw.backgroundImage === 'string' ? raw.backgroundImage : typeof raw.background === 'string' ? raw.background : undefined
  const attributes = isRecord(raw.attributes) ? raw.attributes : {}
  const color = typeof attributes['data-background-color'] === 'string' ? attributes['data-background-color'].trim() : ''
  return {
    ...(typeof attributes['data-transition'] === 'string' ? { transition: attributes['data-transition'] } : {}),
    ...(attributes['data-auto-animate'] !== undefined && attributes['data-auto-animate'] !== 'false' ? { autoAnimate: true } : {}),
    ...(typeof raw.notes === 'string' ? { notes: raw.notes } : {}),
    ...(Array.isArray(raw.sources) ? { sources: raw.sources } : {}),
    ...(layout === 'title' || layout === 'section' || layout === 'statement' || layout === 'closing' || layout === 'quote' ? { align: 'center' } : {}),
    ...(layout === 'section' ? { tone: 'inverse' } : {}),
    ...(background
      ? { background: { image: { src: background, overlay: 'gradient' } } }
      : /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(color) ? { background: { color } } : {}),
  }
}

function normalizeSlide(raw: unknown, index: number, context: NormalizeContext): Slide | null {
  const path = `slides.${index}`
  if (!isRecord(raw)) {
    context.add('warning', path, 'Skipped a slide that is not an object.')
    return null
  }
  const slideRaw: Record<string, unknown> = { ...raw }
  const hasBlocks = Array.isArray(slideRaw.blocks) || isRecord(slideRaw.blocks)
  if (!hasBlocks) {
    const legacyKeys = ['title', 'content', 'subtitle', 'kicker', 'stats', 'columns', 'timeline', 'quote', 'code', 'image', 'layout']
    if (legacyKeys.some((key) => key in slideRaw)) {
      const converted = blocksFromLegacySlide(slideRaw)
      Object.assign(slideRaw, legacySlideFields(slideRaw), { blocks: converted })
      for (const key of [...legacyKeys, 'backgroundImage', 'fragments', 'attributes']) delete slideRaw[key]
      if (typeof slideRaw.background === 'string') delete slideRaw.background
      context.add('info', path, 'Converted a v1-style slide into primitive blocks.')
    } else if (Array.isArray(slideRaw.children)) {
      slideRaw.blocks = slideRaw.children
      delete slideRaw.children
    }
  }

  const idCandidate = slideRaw.id
  let id: string
  if (typeof idCandidate === 'string' && BLOCK_ID_PATTERN.test(idCandidate) && !context.slideIds.has(idCandidate) && !context.blockIds.has(idCandidate)) {
    id = idCandidate
  } else {
    if (idCandidate !== undefined) context.add('info', `${path}.id`, 'Replaced a missing, invalid or duplicate slide id.')
    let counter = index + 1
    do {
      id = `s${counter}`
      counter += 1
    } while (context.slideIds.has(id) || context.blockIds.has(id))
  }
  context.slideIds.add(id)
  context.slideId = id
  context.blockCounter = 0
  context.blocksInSlide = 0

  const { blocks: rawBlocks, ...fields } = slideRaw
  delete fields.id
  const fieldValues = repairFields(slideFieldsShape, fields, path, context)
  const blocks = normalizeBlocks(rawBlocks, `${path}.blocks`, context)
  const slide: Slide = { ...fieldValues, id, blocks } as Slide
  if (slide.background && Object.keys(slide.background).length === 0) delete slide.background
  if (slide.background?.gradient === 'duotone' && !slide.tone) slide.tone = 'accent'
  if (!blocks.length && !slide.background?.image) context.add('warning', path, 'This slide has no content blocks.')
  context.slideId = ''
  return slide
}

function unwrapDeck(input: unknown): unknown {
  if (Array.isArray(input)) return { slides: input }
  if (!isRecord(input)) return input
  if (!Array.isArray(input.slides)) {
    for (const key of ['deck', 'presentation', 'document', 'data']) {
      if (isRecord(input[key]) && Array.isArray((input[key] as Record<string, unknown>).slides)) return input[key]
    }
  }
  return input
}

/**
 * Validates and repairs a generated or stored deck. Returns a deck whenever at
 * least one slide survives, together with diagnostics describing every change.
 */
export function normalizeDeck(input: unknown): NormalizeResult {
  const context = new NormalizeContext()
  const unwrapped = unwrapDeck(input)
  if (!isRecord(unwrapped)) {
    context.add('error', '', 'A presentation must be a JSON object with slides.')
    return { deck: null, diagnostics: context.diagnostics }
  }
  const { slides: rawSlides, version, ...meta } = unwrapped
  if (version !== undefined && version !== DECK_VERSION) context.add('info', 'version', `Read a version ${String(version)} document as version ${DECK_VERSION}.`)
  if (isRecord(meta.theme) && typeof meta.theme.preset !== 'string' && typeof (meta.theme as { name?: unknown }).name === 'string') {
    meta.theme = { ...meta.theme, preset: (meta.theme as { name: string }).name }
    delete (meta.theme as { name?: unknown }).name
  }
  if (typeof meta.theme === 'string') meta.theme = { preset: meta.theme }
  // v1 decks keep plugins/revealOptions at the top level.
  if (isRecord(meta.revealOptions)) {
    meta.settings = { ...(isRecord(meta.settings) ? meta.settings : {}), ...meta.revealOptions }
    delete (meta.settings as Record<string, unknown>).center
    delete meta.revealOptions
  }
  delete meta.plugins

  const metaValues = repairFields(deckMetaShape, meta, '', context)
  if (meta.theme !== undefined && !metaValues.theme) context.add('warning', 'theme', 'The theme was invalid; the default theme is used.')

  const slideList = Array.isArray(rawSlides) ? rawSlides : []
  if (slideList.length > MAX_SLIDES) context.add('warning', 'slides', `Kept the first ${MAX_SLIDES} slides.`)
  const slides = slideList.slice(0, MAX_SLIDES)
    .map((slide, index) => normalizeSlide(slide, index, context))
    .filter((slide): slide is Slide => slide !== null)

  if (!slides.length) {
    context.add('error', 'slides', 'The presentation has no valid slides.')
    return { deck: null, diagnostics: context.diagnostics }
  }
  const deck: Deck = { version: DECK_VERSION, ...metaValues, slides } as Deck
  return { deck, diagnostics: context.diagnostics }
}

/** Normalizes loose blocks against an existing deck's id space (for edit operations). */
/** `depth` is the nesting level the blocks will occupy: 0 at the slide root. */
export function normalizeBlocksForSlide(raw: unknown, slideId: string, deck: Deck, path: string, depth = 0): { blocks: Block[]; diagnostics: DeckDiagnostic[] } {
  const context = seededContext(deck)
  context.slideId = slideId
  context.blockCounter = countSlideBlocks(deck, slideId)
  context.blocksInSlide = countSlideBlocks(deck, slideId)
  const list = Array.isArray(raw) ? raw : raw === undefined || raw === null ? [] : [raw]
  const blocks = list.slice(0, depth === 0 ? MAX_TOP_LEVEL_BLOCKS : MAX_CHILDREN)
    .map((block, index) => normalizeBlock(block, `${path}.${index}`, context, depth))
    .filter((block): block is Block => block !== null)
  return { blocks, diagnostics: context.diagnostics }
}

/** Normalizes a single slide against an existing deck's ids (for add/replace operations). */
export function normalizeSlideForDeck(raw: unknown, deck: Deck, path: string, keepId?: string): { slide: Slide | null; diagnostics: DeckDiagnostic[] } {
  const context = seededContext(deck, keepId)
  const slide = normalizeSlide(isRecord(raw) && keepId ? { ...raw, id: keepId } : raw, deck.slides.length, context)
  return { slide, diagnostics: context.diagnostics.map((diagnostic) => ({ ...diagnostic, path: diagnostic.path.replace(/^slides\.\d+/, path) })) }
}

function seededContext(deck: Deck, releaseSlideId?: string): NormalizeContext {
  const context = new NormalizeContext()
  for (const slide of deck.slides) {
    if (slide.id === releaseSlideId) continue
    context.slideIds.add(slide.id)
    walk(slide.blocks, (block) => { if (block.id) context.blockIds.add(block.id) })
  }
  return context
}

function walk(blocks: readonly Block[], visit: (block: Block) => void): void {
  for (const block of blocks) {
    visit(block)
    if (block.children) walk(block.children, visit)
  }
}

function countSlideBlocks(deck: Deck, slideId: string): number {
  let count = 0
  const slide = deck.slides.find((candidate) => candidate.id === slideId)
  if (slide) walk(slide.blocks, () => { count += 1 })
  return count
}
