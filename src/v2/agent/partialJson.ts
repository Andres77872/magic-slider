/**
 * Tolerant parser for JSON that is still streaming in. It returns the value
 * parsed so far and marks which objects and arrays were closed, so callers can
 * render only what is complete (for example every finished slide) while the
 * tool-call arguments keep arriving.
 */

export interface PartialJsonResult {
  value: unknown
  /** Objects and arrays whose closing bracket has been read. */
  complete: WeakSet<object>
}

class Parser {
  index = 0
  complete = new WeakSet<object>()

  readonly text: string

  constructor(text: string) {
    this.text = text
  }

  skipWhitespace(): void {
    while (this.index < this.text.length && /\s/.test(this.text[this.index])) this.index += 1
  }

  atEnd(): boolean {
    this.skipWhitespace()
    return this.index >= this.text.length
  }

  parseValue(): { value: unknown; ok: boolean } {
    this.skipWhitespace()
    const character = this.text[this.index]
    if (character === undefined) return { value: undefined, ok: false }
    if (character === '{') return this.parseObject()
    if (character === '[') return this.parseArray()
    if (character === '"') return this.parseString()
    return this.parseLiteral()
  }

  parseObject(): { value: unknown; ok: boolean } {
    const result: Record<string, unknown> = {}
    this.index += 1
    for (;;) {
      if (this.atEnd()) return { value: result, ok: true }
      if (this.text[this.index] === '}') {
        this.index += 1
        this.complete.add(result)
        return { value: result, ok: true }
      }
      if (this.text[this.index] === ',') {
        this.index += 1
        continue
      }
      const key = this.parseString()
      if (!key.ok || typeof key.value !== 'string' || !key.closed) return { value: result, ok: true }
      this.skipWhitespace()
      if (this.text[this.index] !== ':') return { value: result, ok: true }
      this.index += 1
      const value = this.parseValue()
      if (!value.ok) return { value: result, ok: true }
      result[key.value] = value.value
    }
  }

  parseArray(): { value: unknown; ok: boolean } {
    const result: unknown[] = []
    this.index += 1
    for (;;) {
      if (this.atEnd()) return { value: result, ok: true }
      if (this.text[this.index] === ']') {
        this.index += 1
        this.complete.add(result)
        return { value: result, ok: true }
      }
      if (this.text[this.index] === ',') {
        this.index += 1
        continue
      }
      const value = this.parseValue()
      if (!value.ok) return { value: result, ok: true }
      result.push(value.value)
    }
  }

  parseString(): { value: unknown; ok: boolean; closed?: boolean } {
    if (this.text[this.index] !== '"') return { value: undefined, ok: false }
    let raw = ''
    this.index += 1
    while (this.index < this.text.length) {
      const character = this.text[this.index]
      if (character === '\\') {
        if (this.index + 1 >= this.text.length) break
        const escape = this.text[this.index + 1]
        if (escape === 'u') {
          const hex = this.text.slice(this.index + 2, this.index + 6)
          if (hex.length < 4) break
          raw += String.fromCharCode(Number.parseInt(hex, 16))
          this.index += 6
          continue
        }
        raw += ({ n: '\n', t: '\t', r: '\r', b: '\b', f: '\f' } as Record<string, string>)[escape] ?? escape
        this.index += 2
        continue
      }
      if (character === '"') {
        this.index += 1
        return { value: raw, ok: true, closed: true }
      }
      raw += character
      this.index += 1
    }
    this.index = this.text.length
    return { value: raw, ok: true, closed: false }
  }

  parseLiteral(): { value: unknown; ok: boolean } {
    const match = /^(?:-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|true|false|null)/.exec(this.text.slice(this.index))
    if (!match) return { value: undefined, ok: false }
    const end = this.index + match[0].length
    // A number at the very end may still be growing ("12" → "125").
    if (end >= this.text.length && /\d$/.test(match[0])) {
      this.index = this.text.length
      return { value: undefined, ok: false }
    }
    this.index = end
    return { value: JSON.parse(match[0]), ok: true }
  }
}

export function parsePartialJson(text: string): PartialJsonResult {
  const parser = new Parser(text)
  const { value } = parser.parseValue()
  return { value, complete: parser.complete }
}

/** The finished items of a streaming array property, e.g. completed slides of a deck. */
export function completedItems(text: string, property: string): unknown[] {
  const { value, complete } = parsePartialJson(text)
  if (!value || typeof value !== 'object' || Array.isArray(value)) return []
  const items = (value as Record<string, unknown>)[property]
  if (!Array.isArray(items)) return []
  return items.filter((item) => item !== null && typeof item === 'object' && complete.has(item as object))
}
