import { z } from 'zod'

import { iconNames } from '../catalog/icons'
import { blockBaseSchema, primitives, primitiveTypes } from '../catalog/registry'
import type { PrimitiveDefinition } from '../catalog/types'
import { MAX_SLIDES, deckMetaShape, slideShape } from '../domain/deckSchema'
import { operationNames } from '../domain/operations'
import { decorations, fontNames, gradientPresets, themePresetNames, themePresets } from '../render/theme'

/**
 * The agent-facing contract, derived from the same code that validates and
 * renders decks: the client-side tool schemas and the catalog text embedded in
 * the author prompt. scripts/build-agent-v2.mjs writes both into the agent
 * graph, and a test fails if the committed graph drifts from this module.
 */

export const CREATE_TOOL = 'create_presentation'
export const EDIT_TOOL = 'edit_presentation'
export const TOOL_ALIASES: Record<string, typeof CREATE_TOOL | typeof EDIT_TOOL> = {
  create_presentation: CREATE_TOOL,
  create_deck: CREATE_TOOL,
  edit_presentation: EDIT_TOOL,
  apply_changes: EDIT_TOOL,
  edit_deck: EDIT_TOOL,
}

type JsonSchema = Record<string, unknown>

function toJson(schema: z.ZodType): JsonSchema {
  const json = z.toJSONSchema(schema, { unrepresentable: 'any', io: 'input' }) as JsonSchema
  delete json.$schema
  return json
}

const blockJsonSchema: JsonSchema = {
  type: 'object',
  description: 'One primitive block: {"type": <primitive>, ...its props}, exactly as specified in the Primitive catalog of your instructions. Containers (stack, grid, box) nest blocks in "children".',
  required: ['type'],
  properties: {
    type: { type: 'string', enum: [...primitiveTypes] },
    id: { type: 'string', description: 'Optional stable id (letters, digits, - and _). Generated when omitted.' },
    children: { type: 'array', description: 'Containers only: nested blocks.', items: { type: 'object' } },
  },
  additionalProperties: true,
}

function slideJsonSchema(): JsonSchema {
  const fields = toJson(z.strictObject({ ...slideShape, id: slideShape.id.optional() }))
  const properties = fields.properties as Record<string, JsonSchema>
  properties.id.description = 'Stable slide id such as "cover" or "market-size". Generated when omitted.'
  properties.blocks = { type: 'array', minItems: 1, maxItems: 24, items: blockJsonSchema, description: 'Top-level blocks, laid out top to bottom.' }
  return { ...fields, required: ['blocks'], description: 'A slide: blocks plus slide-level settings.' }
}

function deckJsonSchema(): JsonSchema {
  const meta = toJson(z.strictObject(deckMetaShape))
  const properties = meta.properties as Record<string, JsonSchema>
  properties.slides = { type: 'array', minItems: 1, maxItems: MAX_SLIDES, items: slideJsonSchema() }
  return { ...meta, required: ['slides'] }
}

const idProp = (description: string): JsonSchema => ({ type: 'string', description })
const anchorProp: JsonSchema = {
  anyOf: [{ type: 'string' }, { type: 'null' }],
  description: 'Slide id to insert after; null inserts at the beginning; omit to append at the end.',
}
const setProp = (description: string): JsonSchema => ({ type: 'object', additionalProperties: true, description })

function operationJsonSchema(): JsonSchema {
  // The full slide schema is spelled out once, in create_presentation.
  const slide: JsonSchema = { type: 'object', required: ['blocks'], additionalProperties: true, description: 'A Slide exactly as in create_presentation: {id?, name?, blocks, background?, tone?, align?, notes?, sources?, …}.' }
  const variants: Record<string, { properties: Record<string, JsonSchema>; required: string[]; description: string }> = {
    add_slides: { description: 'Insert new slides.', properties: { after: anchorProp, slides: { type: 'array', minItems: 1, maxItems: 20, items: slide } }, required: ['slides'] },
    replace_slide: { description: 'Rebuild one slide completely (keeps its id).', properties: { slideId: idProp('Existing slide id.'), slide }, required: ['slideId', 'slide'] },
    update_slide: { description: 'Change slide-level fields (background, tone, align, notes, sources, name, transition, blocks…). null removes a field.', properties: { slideId: idProp('Existing slide id.'), set: setProp('Slide fields to change.') }, required: ['slideId', 'set'] },
    remove_slides: { description: 'Delete slides (only when asked). A deck keeps at least one slide.', properties: { slideIds: { type: 'array', items: { type: 'string' }, minItems: 1 } }, required: ['slideIds'] },
    move_slide: { description: 'Move a slide after another slide (null = to the beginning).', properties: { slideId: idProp('Slide to move.'), after: anchorProp }, required: ['slideId', 'after'] },
    duplicate_slide: { description: 'Copy a slide (new ids), placed after the original unless "after" is given.', properties: { slideId: idProp('Slide to copy.'), after: anchorProp }, required: ['slideId'] },
    update_block: { description: 'Shallow-merge props into a block; null removes a prop. Cannot change "type" (use replace_block).', properties: { blockId: idProp('Existing block id.'), slideId: idProp('Optional slide id hint.'), set: setProp('Props to change, e.g. {"text": "…"} or {"series": […]}.') }, required: ['blockId', 'set'] },
    replace_block: { description: 'Replace a block (and its children) with a new block; keeps the id.', properties: { blockId: idProp('Existing block id.'), slideId: idProp('Optional slide id hint.'), block: blockJsonSchema }, required: ['blockId', 'block'] },
    duplicate_block: { description: 'Copy a block and its children (new ids), placed right after the original.', properties: { blockId: idProp('Block to copy.'), slideId: idProp('Optional slide id hint.') }, required: ['blockId'] },
    insert_blocks: { description: 'Insert blocks into a slide root or into a container block (parentId), at index (default: end).', properties: { slideId: idProp('Target slide id.'), parentId: { anyOf: [{ type: 'string' }, { type: 'null' }], description: 'Container block id; omit or null for the slide root.' }, index: { type: 'integer', minimum: 0 }, blocks: { type: 'array', minItems: 1, maxItems: 24, items: blockJsonSchema } }, required: ['slideId', 'blocks'] },
    remove_blocks: { description: 'Delete blocks by id.', properties: { blockIds: { type: 'array', items: { type: 'string' }, minItems: 1 }, slideId: idProp('Optional slide id hint.') }, required: ['blockIds'] },
    move_block: { description: 'Move a block to another container or slide.', properties: { blockId: idProp('Block to move.'), toSlideId: idProp('Target slide (default: same slide).'), parentId: { anyOf: [{ type: 'string' }, { type: 'null' }], description: 'Target container id; null or omitted for the slide root.' }, index: { type: 'integer', minimum: 0 } }, required: ['blockId'] },
    update_deck: { description: 'Change deck-level title, language, theme (merged; a new preset clears color overrides) or settings.', properties: { set: setProp('For example {"theme": {"preset": "paper"}} or {"settings": {"transition": "fade"}}.') }, required: ['set'] },
  }
  if (Object.keys(variants).sort().join() !== [...operationNames].sort().join()) throw new Error('Operation schema and tool contract are out of sync.')
  return {
    oneOf: Object.entries(variants).map(([op, variant]) => ({
      type: 'object',
      description: variant.description,
      required: ['op', ...variant.required],
      properties: { op: { type: 'string', const: op }, ...variant.properties },
      additionalProperties: false,
    })),
  }
}

export interface FunctionTool {
  type: 'function'
  function: { name: string; description: string; parameters: JsonSchema }
}

export function presentationTools(): FunctionTool[] {
  return [
    {
      type: 'function',
      function: {
        name: CREATE_TOOL,
        description: 'Create a complete new presentation (or explicitly replace the current one) as a v2 deck of primitive blocks. The browser validates and renders it.',
        parameters: deckJsonSchema(),
      },
    },
    {
      type: 'function',
      function: {
        name: EDIT_TOOL,
        description: 'Edit the current presentation with ordered operations addressed by slide and block ids. Put every change of the request in one call.',
        parameters: {
          type: 'object',
          required: ['operations'],
          properties: { operations: { type: 'array', minItems: 1, maxItems: 60, items: operationJsonSchema() } },
          additionalProperties: false,
        },
      },
    },
  ]
}

/* ---------- catalog text ---------- */

/** Compact TypeScript-like signature of a JSON schema, for the prompt. */
export function signature(schema: JsonSchema, depth = 0): string {
  if (depth > 8) return 'object'
  if (Array.isArray(schema.enum)) return schema.enum.map((value) => JSON.stringify(value)).join('|')
  if (schema.const !== undefined) return JSON.stringify(schema.const)
  const union = (schema.anyOf ?? schema.oneOf) as JsonSchema[] | undefined
  if (union) return union.map((item) => signature(item, depth + 1)).join(' | ')
  switch (schema.type) {
    case 'string': return typeof schema.maxLength === 'number' ? `string≤${schema.maxLength}` : 'string'
    case 'number': return range('number', schema)
    case 'integer': return range('int', schema)
    case 'boolean': return 'bool'
    case 'null': return 'null'
    case 'array': {
      const items = signature((schema.items as JsonSchema) ?? {}, depth + 1)
      const bounds = typeof schema.minItems === 'number' || typeof schema.maxItems === 'number' ? `(${schema.minItems ?? 0}-${schema.maxItems ?? '∞'})` : ''
      return `${items.includes('|') || items.includes(' ') ? `(${items})` : items}[]${bounds}`
    }
    case 'object': {
      const properties = schema.properties as Record<string, JsonSchema> | undefined
      if (!properties) return 'object'
      const required = new Set((schema.required as string[]) ?? [])
      return `{${Object.entries(properties).map(([key, value]) => `${key}${required.has(key) ? '' : '?'}: ${signature(value, depth + 1)}`).join(', ')}}`
    }
    default: return 'any'
  }
}

function range(label: string, schema: JsonSchema): string {
  const min = schema.minimum ?? schema.exclusiveMinimum
  const max = schema.maximum ?? schema.exclusiveMaximum
  if (min === undefined && max === undefined) return label
  const safe = (value: unknown) => (typeof value === 'number' && Math.abs(value) < 1e15 ? String(value) : '')
  if (safe(min) === '' && safe(max) === '') return label
  if (safe(max) === '') return `${label} ≥${safe(min)}`
  if (safe(min) === '') return `${label} ≤${safe(max)}`
  return `${label} ${safe(min)}-${safe(max)}`
}

function describePrimitive(primitive: PrimitiveDefinition): string {
  const props = signature(toJson(primitive.props))
  const children = primitive.container ? ', children: Block[]' : ''
  const lines = [`- ${primitive.type}: ${primitive.summary}`, `  props ${props.slice(0, -1)}${children}}`]
  if (primitive.guidance) lines.push(`  use: ${primitive.guidance}`)
  lines.push(`  e.g. ${JSON.stringify(primitive.example)}`)
  return lines.join('\n')
}

const categoryTitles: Record<PrimitiveDefinition['category'], string> = {
  layout: 'Layout (containers)',
  text: 'Text',
  media: 'Media',
  data: 'Data',
  narrative: 'Narrative',
}

export function catalogText(): string {
  const categories = [...new Set(primitives.map((primitive) => primitive.category))]
  const sections = categories.map((category) => [
    `### ${categoryTitles[category]}`,
    ...primitives.filter((primitive) => primitive.category === category).map(describePrimitive),
  ].join('\n'))

  const themeLines = themePresetNames.map((name) => {
    const preset = themePresets[name]
    return `${name} (${preset.mode}, accent ${preset.accent}, ${preset.heading}/${preset.body})`
  })

  return [
    '## Deck document',
    `Deck: ${signature(toJson(z.strictObject(deckMetaShape))).slice(0, -1)}, slides: Slide[](1-${MAX_SLIDES})}`,
    `Slide: ${signature(toJson(z.strictObject({ ...slideShape, id: slideShape.id.optional() }))).slice(0, -1)}, blocks: Block[](1-24)}`,
    `Every block: {type, ...props} plus optional shared props ${signature(toJson(blockBaseSchema))}.`,
    '- id: stable id for later edits. reveal: the block appears on the next click (Reveal fragment); revealOrder groups/orders reveals.',
    '- morphId: the same morphId on blocks of two consecutive autoAnimate slides morphs one into the other (position, size, color).',
    '- span/rowSpan: cells a block covers inside a grid. grow: fills remaining height in a vertical container. maxWidth: limits line length.',
    'Color values are palette roles (background, surface, text, muted, accent, accent2, success, warning, danger, info) or #hex. Prefer roles so the deck follows its theme.',
    'Rich text (text, heading, list items, quotes, callouts, table cells): **bold**, *italic*, `code`, ==accent highlight==, ~~strike~~, [label](https://url). Newline = line break; blank line = new paragraph (text). Never HTML.',
    '',
    '## Themes',
    `Presets: ${themeLines.join('; ')}.`,
    `Fonts (theme.fonts.heading/body): ${fontNames.join(', ')}. Radius: none|sm|md|lg|xl. Decoration (theme.decoration or slide background.pattern): ${decorations.join(', ')}.`,
    `Named background gradients: ${gradientPresets.join(', ')} (duotone paints accent→accent2 and switches the slide to accent tone).`,
    'Slide tone: "inverse" swaps text/background (strong section breaks), "accent" paints the slide in the accent color. Image backgrounds: overlay "gradient" (default: scrim on the text side), "dim", "dark", "light", "accent" or "none".',
    '',
    '## Primitive catalog',
    ...sections,
    '',
    `## Icons\n${iconNames.join(', ')}`,
  ].join('\n')
}
