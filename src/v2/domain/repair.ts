import type { z } from 'zod'

/**
 * Schema-guided repair for generated JSON. Language models produce values
 * that are almost right: a number as a string, a label a few characters too
 * long, an enum in the wrong case, an extra field. Instead of rejecting a
 * whole deck, each validation issue is either fixed conservatively or the
 * offending optional value is dropped, and every change is reported.
 * Required content is never invented: if it is missing, the value fails.
 */

export type RepairNote = { path: string; message: string }

type Path = ReadonlyArray<PropertyKey>

const MAX_ATTEMPTS = 80

const ENUM_SYNONYMS: Record<string, string> = {
  left: 'start',
  right: 'end',
  middle: 'center',
  centre: 'center',
  top: 'start',
  bottom: 'end',
  row: 'horizontal',
  column: 'vertical',
  col: 'vertical',
  numbered: 'number',
  ordered: 'number',
  bullets: 'bullet',
  checklist: 'check',
  medium: 'md',
  large: 'lg',
  small: 'sm',
  xlarge: 'xl',
  'extra-large': 'xl',
  bar: 'bar',
  horizontal: 'horizontal',
}

function pathText(base: string, path: Path): string {
  return [base, ...path.map(String)].filter(Boolean).join('.')
}

function getAt(root: unknown, path: Path): unknown {
  let current = root
  for (const key of path) {
    if (current === null || typeof current !== 'object') return undefined
    current = (current as Record<PropertyKey, unknown>)[key]
  }
  return current
}

function setAt(root: unknown, path: Path, value: unknown): boolean {
  if (!path.length) return false
  const parent = getAt(root, path.slice(0, -1))
  if (parent === null || typeof parent !== 'object') return false
  ;(parent as Record<PropertyKey, unknown>)[path[path.length - 1]] = value
  return true
}

function deleteAt(root: unknown, path: Path): boolean {
  if (!path.length) return false
  const parent = getAt(root, path.slice(0, -1))
  if (parent === null || typeof parent !== 'object') return false
  const key = path[path.length - 1]
  if (Array.isArray(parent) && typeof key === 'number') {
    if (key >= parent.length) return false
    parent.splice(key, 1)
    return true
  }
  if (!Object.prototype.hasOwnProperty.call(parent, key)) return false
  delete (parent as Record<PropertyKey, unknown>)[key]
  return true
}

/** Parses "42", "42%", "1,200", "$3.5" into numbers; returns null for real text. */
export function coerceNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value !== 'string') return null
  const cleaned = value.trim().replace(/[,\s]/g, '').replace(/^[$€£¥]/, '').replace(/%$/, '')
  if (!/^-?\d+(?:\.\d+)?$/.test(cleaned)) return null
  const parsed = Number(cleaned)
  return Number.isFinite(parsed) ? parsed : null
}

function truncate(text: string, maximum: number): string {
  if (text.length <= maximum) return text
  return maximum > 1 ? `${text.slice(0, maximum - 1).trimEnd()}…` : text.slice(0, maximum)
}

/** Index of the innermost array element on a path, for removing a broken list item. */
function arrayElementPath(root: unknown, path: Path): Path | null {
  for (let length = path.length; length > 0; length -= 1) {
    const key = path[length - 1]
    if (typeof key === 'number' && Array.isArray(getAt(root, path.slice(0, length - 1)))) return path.slice(0, length)
  }
  return null
}

interface IssueLike {
  code: string
  path: PropertyKey[]
  message: string
  expected?: string
  maximum?: number | bigint
  minimum?: number | bigint
  origin?: string
  values?: unknown[]
  keys?: string[]
}

/**
 * Validates `input` against `schema`, repairing what it safely can.
 * `required` lists top-level keys that must never be dropped.
 */
export function repairWithSchema<T>(
  schema: z.ZodType<T>,
  input: unknown,
  options: { basePath?: string; required?: ReadonlySet<string>; notes?: RepairNote[] } = {},
): { ok: true; data: T; notes: RepairNote[] } | { ok: false; notes: RepairNote[]; message: string } {
  const notes = options.notes ?? []
  const base = options.basePath ?? ''
  const candidate: unknown = input === undefined ? undefined : structuredClone(input)
  const dropped = new Set<string>()
  let lastMessage = 'Invalid value.'

  const replace = (path: Path, next: unknown): boolean => {
    if (Object.is(getAt(candidate, path), next)) return false
    return setAt(candidate, path, next)
  }

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    const result = schema.safeParse(candidate)
    if (result.success) return { ok: true, data: result.data, notes }
    let changed = false
    lastMessage = result.error.issues.map((issue) => `${pathText('', issue.path as Path) || '(value)'}: ${issue.message}`).slice(0, 3).join('; ')

    for (const rawIssue of result.error.issues) {
      const issue = rawIssue as unknown as IssueLike
      const path = issue.path as Path
      const value = getAt(candidate, path)
      const where = pathText(base, path)
      const note = (message: string) => notes.push({ path: where, message })

      if (issue.code === 'unrecognized_keys' && issue.keys?.length) {
        for (const key of issue.keys) {
          if (deleteAt(candidate, [...path, key])) {
            notes.push({ path: pathText(base, [...path, key]), message: 'Dropped an unsupported field.' })
            changed = true
          }
        }
        continue
      }

      if (issue.code === 'invalid_type') {
        if (issue.expected === 'int' && typeof value === 'number' && Number.isFinite(value)) {
          if (replace(path, Math.round(value))) { changed = true; continue }
        }
        if (issue.expected === 'string' && (typeof value === 'number' || typeof value === 'boolean')) {
          if (replace(path, String(value))) { changed = true; continue }
        }
        if ((issue.expected === 'number' || issue.expected === 'int') && typeof value === 'string' && coerceNumber(value) !== null) {
          const number = coerceNumber(value)!
          if (replace(path, issue.expected === 'int' ? Math.round(number) : number)) { changed = true; continue }
        }
        if (issue.expected === 'boolean' && (value === 'true' || value === 'false')) {
          if (replace(path, value === 'true')) { changed = true; continue }
        }
        if (issue.expected === 'array' && typeof value === 'string' && value.trim()) {
          const lines = value.split(/\r?\n/).map((line) => line.replace(/^\s*(?:[-*•]|\d+[.)])\s+/, '').trim()).filter(Boolean)
          if (replace(path, lines)) { note('Split text into a list.'); changed = true; continue }
        }
        if (issue.expected === 'array' && value !== null && typeof value === 'object' && !Array.isArray(value)) {
          if (replace(path, [value])) { changed = true; continue }
        }
      }

      if (issue.code === 'too_big' && issue.maximum !== undefined) {
        const maximum = Number(issue.maximum)
        if (typeof value === 'string' && replace(path, truncate(value, maximum))) {
          note(`Shortened text to ${maximum} characters.`)
          changed = true
          continue
        }
        if (Array.isArray(value) && value.length > maximum && replace(path, value.slice(0, maximum))) {
          note(`Kept the first ${maximum} items.`)
          changed = true
          continue
        }
        if (typeof value === 'number' && replace(path, maximum)) { changed = true; continue }
      }

      if (issue.code === 'too_small' && issue.minimum !== undefined && typeof value === 'number') {
        if (replace(path, Number(issue.minimum))) { changed = true; continue }
      }

      if (issue.code === 'invalid_value' && typeof value === 'string' && issue.values?.length) {
        const lower = value.trim().toLowerCase()
        const match = issue.values.find((option) => typeof option === 'string' && option.toLowerCase() === lower)
          ?? (ENUM_SYNONYMS[lower] && issue.values.includes(ENUM_SYNONYMS[lower]) ? ENUM_SYNONYMS[lower] : undefined)
        if (match !== undefined && replace(path, match)) { changed = true; continue }
      }

      // Unfixable value: drop it when optional, or drop the list item holding it.
      // Structural deletions shift array indexes, so re-validate after each one.
      const topKey = path[0]
      const pathKey = pathText('', path)
      const isRequiredTop = path.length === 1 && typeof topKey === 'string' && Boolean(options.required?.has(topKey))
      if (value !== undefined && path.length > 0 && !isRequiredTop && !dropped.has(pathKey)) {
        dropped.add(pathKey)
        if (deleteAt(candidate, path)) {
          note(`Dropped an invalid value (${issue.message}).`)
          changed = true
          break
        }
      }
      if (value === undefined || dropped.has(pathKey)) {
        // A required field is missing: remove the smallest enclosing list item,
        // or else the nearest optional object that contains it.
        const element = arrayElementPath(candidate, path)
        if (element && element.length > 0) {
          const elementKey = `[item]${pathText('', element)}#${attempt}`
          if (!dropped.has(elementKey)) {
            dropped.add(elementKey)
            if (deleteAt(candidate, element)) {
              notes.push({ path: pathText(base, element), message: `Removed an incomplete item (${issue.message}).` })
              changed = true
              break
            }
          }
        }
        let removedAncestor = false
        for (let length = path.length - 1; length >= 1; length -= 1) {
          const ancestor = path.slice(0, length)
          const ancestorKey = `[object]${pathText('', ancestor)}`
          if (dropped.has(ancestorKey)) continue
          if (length === 1 && typeof ancestor[0] === 'string' && options.required?.has(ancestor[0])) break
          dropped.add(ancestorKey)
          if (deleteAt(candidate, ancestor)) {
            notes.push({ path: pathText(base, ancestor), message: `Dropped an incomplete value (${issue.message}).` })
            removedAncestor = true
            break
          }
        }
        if (removedAncestor) {
          changed = true
          break
        }
      }
    }
    if (!changed) break
  }
  return { ok: false, notes, message: lastMessage }
}
