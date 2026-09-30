import { describe, expect, it } from 'vitest'

import { primitives, primitiveTypes } from './registry'
import { parseInline, plainText } from './richText'
import { iconNames } from './icons'
import { normalizeDeck } from '../domain/normalize'
import { buildDeckElement } from '../render/renderDeck'
import { deckTemplates } from '../templates'

describe('primitive catalog', () => {
  it('registers unique primitive types', () => {
    expect(new Set(primitiveTypes).size).toBe(primitiveTypes.length)
    expect(primitiveTypes.length).toBeGreaterThanOrEqual(20)
  })

  it.each(primitives.map((primitive) => [primitive.type, primitive] as const))('%s example validates and renders without diagnostics', (_type, primitive) => {
    const { deck, diagnostics } = normalizeDeck({ slides: [{ id: 's1', blocks: [primitive.example] }] })
    expect(diagnostics.filter((diagnostic) => diagnostic.severity !== 'info')).toEqual([])
    expect(deck?.slides[0].blocks[0].type).toBe(primitive.type)
    const rendered = buildDeckElement(deck!, 'reveal')
    expect(rendered.diagnostics).toEqual([])
    expect(rendered.element.querySelector(`[data-block-id="${deck!.slides[0].blocks[0].id}"]`)).not.toBeNull()
  })

  it('uses only registered icon names in examples', () => {
    const icons = new Set<string>(iconNames)
    const found: string[] = []
    JSON.stringify(primitives.map((primitive) => primitive.example), (key, value) => {
      if ((key === 'icon' || key === 'name') && typeof value === 'string' && !value.includes(' ')) found.push(value)
      return value
    })
    for (const name of found.filter((name) => !['Ada Lovelace'].includes(name))) expect(icons.has(name)).toBe(true)
  })
})

describe('rich text', () => {
  it('parses the inline markdown subset', () => {
    expect(parseInline('A **bold** and *em* with `code`, ==mark== and ~~old~~')).toEqual([
      { type: 'text', value: 'A ' },
      { type: 'strong', children: [{ type: 'text', value: 'bold' }] },
      { type: 'text', value: ' and ' },
      { type: 'em', children: [{ type: 'text', value: 'em' }] },
      { type: 'text', value: ' with ' },
      { type: 'code', children: [{ type: 'text', value: 'code' }] },
      { type: 'text', value: ', ' },
      { type: 'mark', children: [{ type: 'text', value: 'mark' }] },
      { type: 'text', value: ' and ' },
      { type: 'del', children: [{ type: 'text', value: 'old' }] },
    ])
  })

  it('keeps snake_case, unmatched delimiters and HTML as literal text', () => {
    expect(plainText('use snake_case_names and 2 * 3 * 4')).toBe('use snake_case_names and 2 * 3 * 4')
    expect(parseInline('<script>alert(1)</script>')).toEqual([{ type: 'text', value: '<script>alert(1)</script>' }])
  })

  it('only links safe web URLs', () => {
    expect(parseInline('[docs](https://revealjs.com)')[0]).toMatchObject({ type: 'link', href: 'https://revealjs.com' })
    expect(parseInline('[bad](javascript:alert(1))')[0]).toMatchObject({ type: 'em' })
  })

  it('never produces raw HTML elements from text', () => {
    const { deck } = normalizeDeck({ slides: [{ blocks: [{ type: 'text', text: '<img src=x onerror=alert(1)> **ok**' }] }] })
    const { element } = buildDeckElement(deck!, 'reveal')
    expect(element.querySelector('img')).toBeNull()
    expect(element.querySelector('.ms-inline-strong')?.textContent).toBe('ok')
    expect(element.textContent).toContain('<img src=x onerror=alert(1)>')
  })
})

describe('starter templates', () => {
  it.each(deckTemplates.map((template) => [template.id, template] as const))('%s validates and renders cleanly', (_id, template) => {
    const { deck, diagnostics } = normalizeDeck(template.deck)
    expect(diagnostics.filter((diagnostic) => diagnostic.severity !== 'info')).toEqual([])
    const rendered = buildDeckElement(deck!, 'reveal')
    expect(rendered.diagnostics).toEqual([])
    expect(rendered.element.querySelectorAll('section.ms-slide')).toHaveLength(deck!.slides.length)
  })
})
