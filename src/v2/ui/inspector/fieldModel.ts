import { z } from 'zod'

import { blockBaseSchema, getPrimitive } from '../../catalog/registry'
import { colorRoles } from '../../catalog/tokens'

/**
 * Turns zod schemas into form field definitions, so the Design panel is
 * generated from the same catalog that validates and renders blocks: a new
 * primitive or prop gets an editor without UI code.
 */

export type JsonSchema = Record<string, unknown>

export type FieldKind =
  | 'text' | 'number' | 'boolean' | 'enum' | 'color' | 'icon' | 'url' | 'loose'
  | 'string-list' | 'object-list' | 'object' | 'gradient' | 'json'

export type FieldGroup = 'content' | 'layout' | 'style' | 'animation'

export interface FieldDef {
  key: string
  label: string
  kind: FieldKind
  group: FieldGroup
  required: boolean
  schema: JsonSchema
  options?: Array<string | number>
  min?: number
  max?: number
  step?: number
  minItems?: number
  maxItems?: number
  maxLength?: number
  multiline?: boolean
  rich?: boolean
  mono?: boolean
  /** Nested fields for objects and list items. */
  fields?: FieldDef[]
  /** List items may be plain strings (stored as a string when only `text` is set). */
  itemMayBeString?: boolean
}

const schemaCache = new WeakMap<object, JsonSchema>()

export function toJsonSchema(schema: z.ZodType): JsonSchema {
  const cached = schemaCache.get(schema)
  if (cached) return cached
  const json = z.toJSONSchema(schema, { unrepresentable: 'any', io: 'input' }) as JsonSchema
  delete json.$schema
  schemaCache.set(schema, json)
  return json
}

const contentKeys = new Set([
  'text', 'title', 'caption', 'label', 'value', 'items', 'labels', 'series', 'rows', 'src', 'alt', 'name', 'role', 'attribution', 'avatar',
  'image', 'description', 'delta', 'source', 'language', 'poster', 'center', 'axes', 'kind', 'max', 'min', 'valuePrefix', 'valueSuffix',
  'centerLabel', 'highlight', 'lineNumbers', 'url',
])
const layoutKeys = new Set([
  'align', 'justify', 'direction', 'gap', 'padding', 'wrap', 'aspect', 'fit', 'focus', 'orientation', 'spacing', 'span', 'rowSpan', 'grow', 'maxWidth',
])
const animationKeys = new Set(['reveal', 'revealOrder', 'morphId', 'stagger', 'autoplay', 'loop', 'transition', 'autoAnimate'])
const richKeys = new Set(['text', 'description'])
const urlKeys = new Set(['src', 'avatar', 'poster', 'image', 'url'])
const iconKeys = new Set(['icon'])

const labels: Record<string, string> = {
  src: 'Image URL',
  alt: 'Alt text',
  rowSpan: 'Row span',
  maxWidth: 'Max width',
  revealOrder: 'Reveal order',
  morphId: 'Morph id',
  valuePrefix: 'Value prefix',
  valueSuffix: 'Value suffix',
  showValues: 'Show values',
  showLegend: 'Show legend',
  showGrid: 'Show grid',
  highlightRow: 'Highlight row',
  highlightColumn: 'Highlight column',
  centerLabel: 'Center label',
  lineNumbers: 'Line numbers',
  accentBar: 'Accent bar',
  showValue: 'Show value',
  autoAnimate: 'Auto-animate',
}

export function humanize(key: string): string {
  if (labels[key]) return labels[key]
  const spaced = key.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[-_]/g, ' ')
  return spaced.charAt(0).toUpperCase() + spaced.slice(1)
}

function groupFor(key: string, primitiveType: string | null): FieldGroup {
  if (key === 'columns') return primitiveType === 'table' ? 'content' : 'layout'
  if (key === 'size' && primitiveType === 'spacer') return 'layout'
  if (animationKeys.has(key)) return 'animation'
  if (layoutKeys.has(key)) return 'layout'
  if (contentKeys.has(key)) return 'content'
  return 'style'
}

function unionMembers(schema: JsonSchema): JsonSchema[] | null {
  const members = (schema.anyOf ?? schema.oneOf) as JsonSchema[] | undefined
  return Array.isArray(members) ? members : null
}

function enumValues(schema: JsonSchema): Array<string | number> | null {
  if (Array.isArray(schema.enum)) return schema.enum as Array<string | number>
  if (schema.const !== undefined) return [schema.const as string]
  return null
}

function isColorSchema(schema: JsonSchema): boolean {
  const members = unionMembers(schema)
  if (!members) return false
  const roles = members.flatMap((member) => enumValues(member) ?? [])
  return colorRoles.every((role) => roles.includes(role)) && members.some((member) => typeof member.pattern === 'string')
}

function isGradientSchema(key: string, schema: JsonSchema): boolean {
  const members = unionMembers(schema)
  return key === 'gradient' && Boolean(members?.some((member) => member.type === 'object')) && Boolean(members?.some((member) => enumValues(member)))
}

export function fieldFor(key: string, schema: JsonSchema, required: boolean, primitiveType: string | null): FieldDef {
  const base = { key, label: humanize(key), group: groupFor(key, primitiveType), required, schema }
  if (isColorSchema(schema)) return { ...base, kind: 'color' }
  if (isGradientSchema(key, schema)) return { ...base, kind: 'gradient' }
  const members = unionMembers(schema)
  if (members) {
    const values = members.map(enumValues)
    if (values.every(Boolean)) return { ...base, kind: 'enum', options: values.flat() as Array<string | number> }
    // String items or objects with a text field (list items).
    const objectMember = members.find((member) => member.type === 'object')
    if (members.length === 2 && objectMember && members.some((member) => member.type === 'string')) {
      return { ...base, kind: 'object', fields: objectFields(objectMember, primitiveType), itemMayBeString: true }
    }
    // Numbers, words or enum-with-literal unions (grid columns, spacer size) edit as text.
    if (members.every((member) => ['string', 'number', 'integer'].includes(String(member.type)) || enumValues(member))) {
      const options = members.flatMap((member) => enumValues(member) ?? [])
      return { ...base, kind: 'loose', options: options.length ? options : undefined }
    }
    return { ...base, kind: 'json' }
  }
  const values = enumValues(schema)
  if (values) return { ...base, kind: 'enum', options: values }
  switch (schema.type) {
    case 'boolean':
      return { ...base, kind: 'boolean' }
    case 'number':
    case 'integer':
      // Small integer ranges (heading level, list columns) read better as buttons.
      if (schema.type === 'integer' && typeof schema.minimum === 'number' && typeof schema.maximum === 'number' && schema.maximum - schema.minimum <= 5) {
        return { ...base, kind: 'enum', options: Array.from({ length: schema.maximum - schema.minimum + 1 }, (_, index) => (schema.minimum as number) + index) }
      }
      return {
        ...base,
        kind: 'number',
        min: typeof schema.minimum === 'number' ? schema.minimum : typeof schema.exclusiveMinimum === 'number' ? schema.exclusiveMinimum : undefined,
        max: typeof schema.maximum === 'number' && Math.abs(schema.maximum) < 1e15 ? schema.maximum : undefined,
        step: schema.type === 'integer' ? 1 : undefined,
      }
    case 'string': {
      const maxLength = typeof schema.maxLength === 'number' ? schema.maxLength : undefined
      if (urlKeys.has(key)) return { ...base, kind: 'url', maxLength }
      if (iconKeys.has(key) || (primitiveType === 'icon' && key === 'name')) return { ...base, kind: 'icon' }
      const mono = key === 'source'
      return { ...base, kind: 'text', maxLength, multiline: mono || (maxLength ?? 0) >= 300, rich: richKeys.has(key) && !mono, mono }
    }
    case 'array': {
      const items = (schema.items ?? {}) as JsonSchema
      const common = {
        minItems: typeof schema.minItems === 'number' ? schema.minItems : undefined,
        maxItems: typeof schema.maxItems === 'number' ? schema.maxItems : undefined,
      }
      if (items.type === 'string' && !unionMembers(items)) return { ...base, ...common, kind: 'string-list', maxLength: typeof items.maxLength === 'number' ? items.maxLength : undefined }
      const item = fieldFor('item', items, true, primitiveType)
      if (item.kind === 'object') return { ...base, ...common, kind: 'object-list', fields: item.fields, itemMayBeString: item.itemMayBeString }
      return { ...base, kind: 'json' }
    }
    case 'object':
      return { ...base, kind: 'object', fields: objectFields(schema, primitiveType) }
    default:
      return { ...base, kind: 'json' }
  }
}

export function objectFields(schema: JsonSchema, primitiveType: string | null): FieldDef[] {
  const properties = (schema.properties ?? {}) as Record<string, JsonSchema>
  const required = new Set((schema.required as string[] | undefined) ?? [])
  return Object.entries(properties).map(([key, value]) => fieldFor(key, value, required.has(key), primitiveType))
}

/** Fields for a primitive's own props plus the shared block props. */
export function blockFields(type: string): FieldDef[] {
  const primitive = getPrimitive(type)
  if (!primitive) return []
  const own = objectFields(toJsonSchema(primitive.props), type)
  const shared = objectFields(toJsonSchema(blockBaseSchema), type).filter((field) => field.key !== 'id')
  return [...own, ...shared]
}

export const groupTitles: Record<FieldGroup, string> = {
  content: 'Content',
  layout: 'Layout',
  style: 'Style',
  animation: 'Animation',
}

export function groupFields(fields: FieldDef[]): Array<{ group: FieldGroup; fields: FieldDef[] }> {
  return (['content', 'layout', 'style', 'animation'] as const)
    .map((group) => ({ group, fields: fields.filter((field) => field.group === group) }))
    .filter((entry) => entry.fields.length > 0)
}

/** A minimal valid value for a new list item, from its schema. */
export function defaultValue(field: FieldDef): unknown {
  switch (field.kind) {
    case 'text':
    case 'url':
      return field.key === 'src' ? '' : 'New item'
    case 'icon':
      return 'star'
    case 'number':
      return field.min !== undefined && field.min > 0 ? field.min : 0
    case 'boolean':
      return false
    case 'enum':
    case 'loose':
      return field.options?.[0] ?? ''
    case 'string-list':
      return Array.from({ length: Math.max(field.minItems ?? 1, 1) }, (_, index) => `Item ${index + 1}`)
    case 'object': {
      const value: Record<string, unknown> = {}
      for (const nested of field.fields ?? []) if (nested.required) value[nested.key] = defaultValue(nested)
      return value
    }
    default:
      return null
  }
}

export function newListItem(field: FieldDef, index: number): unknown {
  if (field.itemMayBeString) return `New item ${index + 1}`
  const value: Record<string, unknown> = {}
  for (const nested of field.fields ?? []) {
    if (!nested.required) continue
    value[nested.key] = nested.kind === 'text' ? `New ${nested.key} ${index + 1}` : defaultValue(nested)
  }
  return value
}
