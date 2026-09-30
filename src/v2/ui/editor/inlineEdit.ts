import type { Block } from '../../catalog/types'

/**
 * Inline text editing on the canvas. Each primitive declares which rendered
 * elements map to which text props; double-clicking one edits the raw source
 * of that prop in place (rich-text markers such as **bold** stay visible
 * while editing, the "reveal markup" approach), and saving becomes a normal
 * update_block operation.
 */

interface FieldSpec {
  /** Element holding the text, relative to the block (or the item); null is the block root. */
  selector: string | null
  prop: string
  multiline?: boolean
  /** Empty text removes the prop instead of failing validation. */
  optional?: boolean
}

interface ItemSpec {
  /** Array prop whose items are rendered by itemSelector, in order. */
  prop: string
  itemSelector: string
  fields: Array<{ selector: string; field: string | null; multiline?: boolean; optional?: boolean }>
}

/** Listed from the most specific part to the primary field, which is last. */
const fieldSpecs: Record<string, FieldSpec[]> = {
  heading: [{ selector: null, prop: 'text' }],
  text: [{ selector: null, prop: 'text', multiline: true }],
  callout: [{ selector: '.ms-callout__title', prop: 'title', optional: true }, { selector: '.ms-callout__text', prop: 'text', multiline: true }],
  quote: [{ selector: '.ms-quote__name', prop: 'attribution', optional: true }, { selector: '.ms-quote__role', prop: 'role', optional: true }, { selector: '.ms-quote__text', prop: 'text', multiline: true }],
  badge: [{ selector: ':scope > span:last-child', prop: 'text' }],
  stat: [{ selector: '.ms-stat__description', prop: 'description', optional: true, multiline: true }, { selector: '.ms-stat__label', prop: 'label' }, { selector: '.ms-stat__value', prop: 'value' }],
  profile: [{ selector: '.ms-profile__text', prop: 'text', optional: true, multiline: true }, { selector: '.ms-profile__role', prop: 'role', optional: true }, { selector: '.ms-profile__name', prop: 'name' }],
  image: [{ selector: '.ms-image__caption', prop: 'caption', optional: true }],
  video: [{ selector: '.ms-image__caption', prop: 'caption', optional: true }],
  chart: [{ selector: '.ms-chart__title', prop: 'title', optional: true }, { selector: '.ms-chart__caption', prop: 'caption', optional: true }],
  progress: [{ selector: '.ms-progress__label', prop: 'label', optional: true }],
  code: [{ selector: '.ms-code__title', prop: 'title', optional: true }],
}

const itemSpecs: Record<string, ItemSpec> = {
  list: { prop: 'items', itemSelector: '.ms-list__item', fields: [{ selector: '.ms-list__description', field: 'description', optional: true, multiline: true }, { selector: '.ms-list__text', field: 'text' }] },
  timeline: { prop: 'items', itemSelector: '.ms-timeline__item', fields: [{ selector: '.ms-timeline__label', field: 'label', optional: true }, { selector: '.ms-timeline__text', field: 'text', optional: true, multiline: true }, { selector: '.ms-timeline__title', field: 'title' }] },
  diagram: {
    prop: 'items',
    itemSelector: '.ms-diagram__node, .ms-diagram__level, .ms-diagram__quadrant, .ms-diagram__circle',
    fields: [{ selector: '.ms-diagram__text, .ms-diagram__aside', field: 'text', optional: true, multiline: true }, { selector: '.ms-diagram__label', field: 'label' }],
  },
}

export interface InlineTarget {
  element: HTMLElement
  /** Raw source text to edit. */
  value: string
  multiline: boolean
  /** Human name of what is being edited, for the hint. */
  label: string
  /** The props to set for new text, or an error message. */
  commit: (text: string) => { set: Record<string, unknown> } | { error: string } | null
}

export function supportsInlineEdit(type: string): boolean {
  return type in fieldSpecs || type in itemSpecs || type === 'table'
}

function normalizeText(text: string, multiline: boolean): string {
  const clean = text.replace(/\r\n?/g, '\n').replace(/\u00a0/g, ' ').replace(/\n+$/, '')
  return multiline ? clean : clean.replace(/\s*\n\s*/g, ' ')
}

function within(root: HTMLElement, selector: string | null, target: Element | null): HTMLElement | null {
  if (selector === null) return root
  const candidates = [...root.querySelectorAll<HTMLElement>(selector)].filter((node) => node.closest('[data-block-id]') === root)
  return candidates.find((node) => target && node.contains(target)) ?? null
}

function firstWithin(root: HTMLElement, selector: string | null): HTMLElement | null {
  if (selector === null) return root
  return [...root.querySelectorAll<HTMLElement>(selector)].find((node) => node.closest('[data-block-id]') === root) ?? null
}

function fieldTarget(block: Block, element: HTMLElement, spec: FieldSpec): InlineTarget | null {
  const current = block[spec.prop]
  if (typeof current !== 'string') return null
  const multiline = Boolean(spec.multiline)
  return {
    element,
    value: current,
    multiline,
    label: spec.prop,
    commit: (text) => {
      const next = normalizeText(text, multiline)
      if (next === current) return null
      if (!next.trim()) return spec.optional ? { set: { [spec.prop]: null } } : { error: `The ${spec.prop} cannot be empty. Delete the block instead.` }
      return { set: { [spec.prop]: next } }
    },
  }
}

function itemTarget(block: Block, root: HTMLElement, spec: ItemSpec, target: Element | null): InlineTarget | null {
  const items = block[spec.prop]
  if (!Array.isArray(items)) return null
  const itemNodes = [...root.querySelectorAll<HTMLElement>(spec.itemSelector)].filter((node) => node.closest('[data-block-id]') === root)
  const itemIndex = itemNodes.findIndex((node) => target && node.contains(target))
  const index = itemIndex === -1 ? 0 : itemIndex
  const itemNode = itemNodes[index]
  if (!itemNode || index >= items.length) return null
  const field = spec.fields.find((candidate) => [...itemNode.querySelectorAll(candidate.selector)].some((node) => target && node.contains(target)))
    ?? spec.fields[spec.fields.length - 1]
  const element = itemNode.querySelector<HTMLElement>(field.selector)
  if (!element) return null
  const item = items[index] as unknown
  const current = typeof item === 'string' ? (field.field === 'text' ? item : undefined) : (item as Record<string, unknown>)[field.field ?? 'text']
  if (typeof current !== 'string') return null
  const multiline = Boolean(field.multiline)
  return {
    element,
    value: current,
    multiline,
    label: `${field.field ?? 'text'} of item ${index + 1}`,
    commit: (text) => {
      const next = normalizeText(text, multiline)
      if (next === current) return null
      if (!next.trim() && !field.optional) return { error: 'Item text cannot be empty. Remove the item from the Design panel instead.' }
      const nextItems = items.map((entry, entryIndex) => {
        if (entryIndex !== index) return entry
        if (typeof entry === 'string') return next
        const copy = { ...(entry as Record<string, unknown>) }
        if (next.trim()) copy[field.field ?? 'text'] = next
        else delete copy[field.field ?? 'text']
        return copy
      })
      return { set: { [spec.prop]: nextItems } }
    },
  }
}

function tableTarget(block: Block, root: HTMLElement, target: Element | null): InlineTarget | null {
  const cell = target?.closest('th, td') as HTMLTableCellElement | null
  if (!cell || !root.contains(cell)) return null
  const columns = block.columns as Array<string | { header: string }> | undefined
  const rows = block.rows as Array<Array<string | number | null>> | undefined
  if (!columns || !rows) return null
  const columnIndex = cell.cellIndex
  if (cell.closest('thead')) {
    const column = columns[columnIndex]
    const current = typeof column === 'string' ? column : column?.header
    if (current === undefined) return null
    return {
      element: cell,
      value: current,
      multiline: false,
      label: `column ${columnIndex + 1} header`,
      commit: (text) => {
        const next = normalizeText(text, false)
        if (next === current) return null
        return { set: { columns: columns.map((entry, index) => (index !== columnIndex ? entry : typeof entry === 'string' ? next : { ...entry, header: next })) } }
      },
    }
  }
  const row = cell.parentElement as HTMLTableRowElement
  const rowIndex = [...(row.parentElement?.children ?? [])].indexOf(row)
  const value = rows[rowIndex]?.[columnIndex]
  if (rowIndex < 0 || columnIndex >= columns.length) return null
  const current = value === null || value === undefined ? '' : String(value)
  return {
    element: cell,
    value: current,
    multiline: false,
    label: `row ${rowIndex + 1}, column ${columnIndex + 1}`,
    commit: (text) => {
      const next = normalizeText(text, false)
      if (next === current) return null
      const typed: string | number | null = !next.trim() ? null : typeof value === 'number' && Number.isFinite(Number(next)) ? Number(next) : next
      return {
        set: {
          rows: rows.map((entry, index) => {
            if (index !== rowIndex) return entry
            const copy = [...entry]
            while (copy.length <= columnIndex) copy.push(null)
            copy[columnIndex] = typed
            return copy
          }),
        },
      }
    },
  }
}

/**
 * Finds what to edit for a double-click (or Enter) on a rendered block.
 * `target` is the element under the pointer; without one the primary field is used.
 */
export function resolveInlineTarget(block: Block, root: HTMLElement, target: Element | null): InlineTarget | null {
  if (block.type === 'table') return tableTarget(block, root, target ?? root.querySelector('tbody th, tbody td'))
  const items = itemSpecs[block.type]
  if (items) return itemTarget(block, root, items, target)
  const specs = fieldSpecs[block.type]
  if (!specs) return null
  for (const spec of specs) {
    const element = within(root, spec.selector, target)
    if (element && spec.selector !== null) {
      const resolved = fieldTarget(block, element, spec)
      if (resolved) return resolved
    }
  }
  // No specific part under the pointer: the primary (last listed, required) field.
  for (const spec of [...specs].reverse()) {
    const element = firstWithin(root, spec.selector)
    if (element) {
      const resolved = fieldTarget(block, element, spec)
      if (resolved) return resolved
    }
  }
  return null
}
