import { describe, expect, it } from 'vitest'

import { normalizeDeck } from './normalize'

describe('normalizeDeck', () => {
  it('assigns stable slide and block ids and keeps valid authored ids', () => {
    const { deck } = normalizeDeck({
      slides: [
        { id: 'cover', blocks: [{ type: 'heading', id: 'title', text: 'Hello' }, { type: 'text', text: 'World' }] },
        { blocks: [{ type: 'stack', children: [{ type: 'badge', text: 'New' }] }] },
      ],
    })
    expect(deck?.slides.map((slide) => slide.id)).toEqual(['cover', 's2'])
    expect(deck?.slides[0].blocks.map((block) => block.id)).toEqual(['title', 'cover-b1'])
    expect(deck?.slides[1].blocks[0].id).toBe('s2-b1')
    expect(deck?.slides[1].blocks[0].children?.[0].id).toBe('s2-b2')
  })

  it('replaces duplicate ids instead of failing', () => {
    const { deck, diagnostics } = normalizeDeck({
      slides: [
        { id: 'a', blocks: [{ type: 'text', id: 'x', text: 'one' }, { type: 'text', id: 'x', text: 'two' }] },
        { id: 'a', blocks: [{ type: 'text', text: 'three' }] },
      ],
    })
    const ids = deck!.slides.flatMap((slide) => [slide.id, ...slide.blocks.map((block) => block.id)])
    expect(new Set(ids).size).toBe(ids.length)
    expect(diagnostics.some((diagnostic) => diagnostic.message.includes('duplicate'))).toBe(true)
  })

  it('repairs typical model slips without inventing content', () => {
    const { deck, diagnostics } = normalizeDeck({
      title: 'Energy',
      theme: 'ocean',
      slides: [{
        blocks: [
          { type: 'paragraph', content: 'Aliased type and prop' },
          { type: 'stat', value: 42, label: 'Numbers become strings', size: 'LG' },
          { type: 'heading', text: 'x'.repeat(400), align: 'left' },
          { type: 'list', items: '- one\n- two\n- three', style: 'bullets' },
          { type: 'chart', kind: 'column', labels: ['a', 'b'], series: [{ name: 'S', values: ['1,200', '30%'] }] },
          { type: 'image', url: 'https://example.com/a.jpg', description: 'Alt from description', unknownProp: true },
        ],
      }],
    })
    const [text, stat, heading, list, chart, image] = deck!.slides[0].blocks
    expect(deck!.theme).toEqual({ preset: 'ocean' })
    expect(text).toMatchObject({ type: 'text', text: 'Aliased type and prop' })
    expect(stat).toMatchObject({ type: 'stat', value: '42', size: 'lg' })
    expect((heading.text as string).length).toBe(300)
    expect(heading.align).toBe('start')
    expect(list).toMatchObject({ items: ['one', 'two', 'three'], style: 'bullet' })
    expect(chart.series).toEqual([{ name: 'S', values: [1200, 30] }])
    expect(image).toMatchObject({ src: 'https://example.com/a.jpg', alt: 'Alt from description' })
    expect(image).not.toHaveProperty('unknownProp')
    expect(diagnostics.every((diagnostic) => diagnostic.severity !== 'error')).toBe(true)
  })

  it('drops invalid optional props but keeps the block', () => {
    const { deck, diagnostics } = normalizeDeck({ slides: [{ blocks: [{ type: 'badge', text: 'Beta', tone: 'rainbow' }] }] })
    expect(deck!.slides[0].blocks[0]).toMatchObject({ type: 'badge', text: 'Beta' })
    expect(deck!.slides[0].blocks[0]).not.toHaveProperty('tone')
    expect(diagnostics.some((diagnostic) => diagnostic.path.endsWith('tone'))).toBe(true)
  })

  it('skips blocks missing required content and unknown primitives, keeping the rest', () => {
    const { deck, diagnostics } = normalizeDeck({
      slides: [{ blocks: [{ type: 'image', alt: 'no src' }, { type: 'hologram' }, { type: 'text', text: 'kept' }] }],
    })
    expect(deck!.slides[0].blocks).toHaveLength(1)
    expect(deck!.slides[0].blocks[0]).toMatchObject({ type: 'text', text: 'kept' })
    expect(diagnostics.filter((diagnostic) => diagnostic.severity === 'warning')).toHaveLength(2)
  })

  it('rejects unsafe URLs', () => {
    const { deck } = normalizeDeck({
      slides: [{
        background: { image: { src: 'javascript:alert(1)' } },
        sources: [{ title: 'Bad', url: 'data:text/html,hi' }, { title: 'Good', url: 'https://example.org' }],
        blocks: [{ type: 'image', src: 'javascript:alert(1)', alt: 'x' }, { type: 'text', text: 'safe' }],
      }],
    })
    const slide = deck!.slides[0]
    expect(slide.background).toBeUndefined()
    expect(slide.sources).toEqual([{ title: 'Good', url: 'https://example.org' }])
  })

  it('removes a list item with missing required fields rather than the whole block', () => {
    const { deck } = normalizeDeck({
      slides: [{ blocks: [{ type: 'timeline', items: [{ title: 'One' }, { label: 'no title' }, { title: 'Three' }] }] }],
    })
    expect((deck!.slides[0].blocks[0].items as unknown[]).length).toBe(2)
  })

  it('aligns chart series with labels without inventing values', () => {
    const { deck, diagnostics } = normalizeDeck({
      slides: [{
        blocks: [{
          type: 'chart', kind: 'line', labels: ['a', 'b', 'c'],
          series: [{ name: 'long', values: [1, 2, 3, 4] }, { name: 'short', values: [1] }],
        }],
      }],
    })
    expect(deck!.slides[0].blocks[0].series).toEqual([{ name: 'long', values: [1, 2, 3] }])
    expect(diagnostics.some((diagnostic) => diagnostic.message.includes('Dropped a chart series'))).toBe(true)
  })

  it('converts v1 slides into primitive blocks', () => {
    const { deck } = normalizeDeck({
      theme: 'forest',
      revealOptions: { controls: true, transition: 'fade', center: true },
      plugins: ['notes'],
      slides: [
        { layout: 'title', kicker: 'Hi', title: 'Deck', subtitle: 'Sub', backgroundImage: 'https://example.com/c.jpg', notes: 'n' },
        { layout: 'stats', title: 'Numbers', stats: [{ value: '3', label: 'things' }], sources: [{ title: 'S', url: 'https://s.org' }] },
        { layout: 'split', title: 'Pic', content: 'a\nb', image: { url: 'https://example.com/p.jpg', alt: 'p', position: 'left' } },
      ],
    })
    expect(deck!.settings).toEqual({ controls: true, transition: 'fade' })
    expect(deck!.slides[0]).toMatchObject({ align: 'center', notes: 'n', background: { image: { src: 'https://example.com/c.jpg' } } })
    expect(deck!.slides[0].blocks.map((block) => block.type)).toEqual(['text', 'heading', 'text'])
    expect(deck!.slides[1].blocks[1]).toMatchObject({ type: 'grid' })
    expect(deck!.slides[2].blocks[0].children?.[0]).toMatchObject({ type: 'image', aspect: 'fill' })
  })

  it('unwraps common envelopes and fails cleanly without slides', () => {
    expect(normalizeDeck({ presentation: { slides: [{ blocks: [{ type: 'text', text: 'x' }] }] } }).deck?.slides).toHaveLength(1)
    const empty = normalizeDeck({ title: 'nothing' })
    expect(empty.deck).toBeNull()
    expect(empty.diagnostics[0].severity).toBe('error')
  })

  it('is idempotent on a normalized deck', () => {
    const first = normalizeDeck({
      slides: [{ blocks: [{ type: 'grid', children: [{ type: 'stat', value: '1', label: 'a' }, { type: 'text', text: 'b' }] }] }],
    })
    const second = normalizeDeck(first.deck)
    expect(second.deck).toEqual(first.deck)
    expect(second.diagnostics).toEqual([])
  })

  it('enforces nesting depth', () => {
    let block: Record<string, unknown> = { type: 'text', text: 'deep' }
    for (let level = 0; level < 10; level += 1) block = { type: 'stack', children: [block] }
    const { deck, diagnostics } = normalizeDeck({ slides: [{ blocks: [block] }] })
    let depth = 0
    let current = deck!.slides[0].blocks[0]
    while (current.children?.length) {
      depth += 1
      current = current.children[0]
    }
    expect(depth).toBeLessThanOrEqual(6)
    expect(diagnostics.some((diagnostic) => diagnostic.message.includes('deeper'))).toBe(true)
  })
})
