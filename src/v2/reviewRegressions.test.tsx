import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { normalizeDeck } from './domain/normalize'
import { applyOperations, parseOperations } from './domain/operations'
import { formatDeckContext } from './agent/deckContext'
import { generate, type AgentConfig } from './agent/agentClient'
import { buildDeckElement } from './render/renderDeck'
import { ensureContrast, contrastRatio, gradientCss, resolveTheme, themeVariables } from './render/theme'
import { parseLineSteps } from './catalog/primitives/data'
import { createSession, mergeStores } from './session/sessions'
import SlideRail from './ui/SlideRail'
import { createLogger } from '../lib/logger'
import type { Deck } from './domain/deckSchema'

// Each case pins a defect confirmed by the adversarially verified v2 review.

function deckOf(input: unknown): Deck {
  const { deck } = normalizeDeck(input)
  if (!deck) throw new Error('invalid deck')
  return deck
}

function apply(deck: Deck, operations: unknown[]) {
  return applyOperations(deck, parseOperations({ operations }).operations)
}

describe('table repair keeps columns aligned', () => {
  it('accepts a blank corner header and converts boolean cells in place', () => {
    const deck = deckOf({ slides: [{ blocks: [{ type: 'table', columns: ['', 'Free', 'Pro'], rows: [['SSO', false, true], ['Seats', 3, '∞']] }] }] })
    const table = deck.slides[0].blocks[0]
    expect(table.columns).toEqual(['', 'Free', 'Pro'])
    expect(table.rows).toEqual([['SSO', '✗', '✓'], ['Seats', 3, '∞']])
  })

  it('pads short rows and keeps large boolean matrices instead of dropping the table', () => {
    const rows = Array.from({ length: 12 }, (_, index) => [`Feature ${index}`, true, false, true, false])
    const deck = deckOf({ slides: [{ blocks: [{ type: 'table', columns: ['Feature', 'A', 'B', 'C', 'D'], rows: [...rows, ['Short']] }] }] })
    const table = deck.slides[0].blocks[0]
    expect((table.rows as unknown[][]).length).toBe(13)
    expect((table.rows as unknown[][])[12]).toEqual(['Short', null, null, null, null])
  })
})

describe('operations', () => {
  const base = () => deckOf({
    slides: [
      { id: 'a', blocks: [{ type: 'grid', id: 'cards', children: [{ type: 'box', id: 'card-a', children: [{ type: 'text', id: 't', text: 'x' }] }] }, { type: 'text', id: 'keep', text: 'y' }] },
      { id: 'full', blocks: Array.from({ length: 24 }, (_, index) => ({ type: 'text', id: `f${index}`, text: String(index) })) },
    ],
  })

  it('remove_blocks accepts ids nested inside an earlier removed block, in any order', () => {
    const result = apply(base(), [{ op: 'remove_blocks', blockIds: ['cards', 'card-a', 't', 'cards'] }])
    expect(result.failed).toEqual([])
    expect(result.deck.slides[0].blocks.map((block) => block.id)).toEqual(['keep'])
    expect(apply(base(), [{ op: 'remove_blocks', blockIds: ['nope'] }]).failed[0].message).toContain('does not exist')
  })

  it('refuses to insert into a full slide instead of silently dropping existing blocks', () => {
    const result = apply(base(), [{ op: 'insert_blocks', slideId: 'full', index: 0, blocks: [{ type: 'heading', text: 'New' }] }])
    expect(result.failed[0].message).toContain('full')
    expect(result.deck.slides[1].blocks).toHaveLength(24)
    expect(result.deck.slides[1].blocks[23].id).toBe('f23')
  })

  it('merges theme fonts instead of replacing them', () => {
    const deck = deckOf({ theme: { preset: 'ocean', fonts: { heading: 'serif', body: 'modern' } }, slides: [{ blocks: [{ type: 'text', text: 'x' }] }] })
    const result = apply(deck, [{ op: 'update_deck', set: { theme: { fonts: { heading: 'display' } } } }])
    expect(result.deck.theme?.fonts).toEqual({ heading: 'display', body: 'modern' })
  })

  it('edits a deeply nested block without emptying its children', () => {
    let block: Record<string, unknown> = { type: 'text', id: 'leaf', text: 'leaf' }
    for (let level = 6; level >= 1; level -= 1) block = { type: 'stack', id: `n${level}`, children: [block] }
    const deck = deckOf({ slides: [{ id: 's', blocks: [block] }] })
    const result = apply(deck, [{ op: 'update_block', blockId: 'n6', set: { gap: 'lg' } }])
    expect(result.failed).toEqual([])
    expect(JSON.stringify(result.deck)).toContain('"leaf"')
  })
})

describe('v1 conversion', () => {
  it('strips bullet markers in columns and maps v1 slide attributes', () => {
    const deck = deckOf({ slides: [{ title: 'Compare', columns: [{ heading: 'A', content: '- Fast\n- Cheap' }, { heading: 'B', content: 'Only one line' }], attributes: { 'data-background-color': '#102030', 'data-transition': 'zoom', 'data-auto-animate': '' } }] })
    const slide = deck.slides[0]
    const grid = slide.blocks.find((block) => block.type === 'grid')!
    expect(grid.children?.[0].children?.[1]).toMatchObject({ type: 'list', items: ['Fast', 'Cheap'] })
    expect(grid.children?.[1].children?.[1]).toMatchObject({ type: 'text', text: 'Only one line' })
    expect(slide).toMatchObject({ transition: 'zoom', autoAnimate: true, background: { color: '#102030' } })
  })
})

describe('deck context', () => {
  it('never drops slides and always includes the focused slide in full', () => {
    const slides = Array.from({ length: 40 }, (_, index) => ({ id: `slide-${index}`, notes: 'note '.repeat(80), blocks: [{ type: 'text', id: `text-${index}`, text: `Body ${index} ${'words '.repeat(60)}` }] }))
    const deck = deckOf({ slides })
    const text = formatDeckContext(deck, { focusedSlideId: 'slide-39', maxChars: 12_000 })
    expect(text.length).toBeLessThanOrEqual(12_000)
    for (let index = 0; index < 40; index += 1) expect(text).toContain(`id slide-${index}`)
    expect(text).toContain('- text-39 text {"text":"Body 39')
  })
})

describe('agent client text handling', () => {
  const config: AgentConfig = { apiUrl: 'http://localhost/v1/chat/completions', agentModel: 'agt-x', requestTimeoutMs: 5_000, idleTimeoutMs: 5_000, maxStreamBytes: 1_000_000 }
  const silent = createLogger(() => undefined)
  const sse = (content: string) => new Response(new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({ choices: [{ index: 0, delta: { content } }] })}\n\ndata: [DONE]\n\n`))
      controller.close()
    },
  }), { status: 200 })

  it('returns answers that start with "[" or "`" as messages', async () => {
    const result = await generate({ prompt: 'q', config, deck: null }, { fetch: (async () => sse('[Draft] Which slide should change?')) as never, logger: silent })
    expect(result).toMatchObject({ ok: true, kind: 'message', message: '[Draft] Which slide should change?' })
  })

  it('never replaces an existing deck with a deck pasted as text', async () => {
    const deck = deckOf({ slides: [{ id: 'keep', blocks: [{ type: 'text', text: 'mine' }] }] })
    const pasted = JSON.stringify({ slides: [{ blocks: [{ type: 'text', text: 'replacement' }] }] })
    const result = await generate({ prompt: 'q', config, deck }, { fetch: (async () => sse(pasted)) as never, logger: silent })
    expect(result.ok && result.kind === 'deck').toBe(false)
  })
})

describe('rendering and theme', () => {
  it('clamps bars to an explicit axis minimum', () => {
    const deck = deckOf({ slides: [{ blocks: [{ type: 'chart', kind: 'column', labels: ['a', 'b'], series: [{ name: 's', values: [95, 100] }], min: 90, max: 100 }] }] })
    const bars = [...buildDeckElement(deck).element.querySelectorAll<HTMLElement>('.ms-chart__bar')]
    for (const bar of bars) {
      const start = Number.parseFloat(bar.style.getPropertyValue('--ms-start'))
      const size = Number.parseFloat(bar.style.getPropertyValue('--ms-size'))
      expect(start).toBeGreaterThanOrEqual(0)
      expect(start + size).toBeLessThanOrEqual(100.0001)
    }
  })

  it('produces a valid aurora gradient and eight chart colors for every theme', () => {
    const theme = resolveTheme({ preset: 'slate' })
    expect(gradientCss(theme, 'aurora', '#000000')).not.toMatch(/,\s*#[0-9a-f]{6}$/i)
    for (const preset of ['slate', 'mint', 'noir', 'aurora'] as const) {
      const vars = themeVariables(resolveTheme({ preset }))
      for (let index = 1; index <= 8; index += 1) expect(vars[`--ms-chart-${index}`]).toMatch(/^#/)
    }
  })

  it('moves colors toward the higher-contrast side on mid-tone backgrounds', () => {
    const background = '#9d8cff'
    const adjusted = ensureContrast('#b8adff', background, 4.5)
    expect(contrastRatio(adjusted, background)).toBeGreaterThanOrEqual(contrastRatio('#b8adff', background))
  })

  it('validates code highlight steps strictly and renders them without the Reveal plugin', () => {
    expect(parseLineSteps('1,3-5|8', 10)).toEqual([[[1, 1], [3, 5]], [[8, 8]]])
    expect(parseLineSteps('-2', 10)).toBeNull()
    expect(parseLineSteps('5-', 10)).toBeNull()
    const deck = deckOf({ slides: [{ blocks: [{ type: 'code', source: 'a\nb\nc', lineNumbers: true, highlight: '1|2-3', language: 'ts' }] }] })
    const element = buildDeckElement(deck).element
    expect(element.querySelectorAll('.ms-code__gutter span')).toHaveLength(3)
    expect(element.querySelectorAll('.ms-code__mark.fragment')).toHaveLength(2)
    expect(element.querySelector('[data-line-numbers]')).toBeNull()
    expect(normalizeDeck({ slides: [{ blocks: [{ type: 'code', source: 'x', highlight: '1--2' }] }] }).deck!.slides[0].blocks[0]).not.toHaveProperty('highlight')
  })

  it('rejects image URLs that Reveal cannot decode', () => {
    const deck = deckOf({ slides: [{ background: { image: { src: 'https://example.com/50%off.jpg' } }, blocks: [{ type: 'text', text: 'x' }] }] })
    expect(deck.slides[0].background).toBeUndefined()
  })
})

describe('sessions across tabs', () => {
  it('merges another tab\'s saved sessions, newest copy wins, deletions stay deleted', () => {
    const a = { ...createSession(), id: 'a', title: 'A', updatedAt: '2026-01-01T00:00:00Z' }
    const b = { ...createSession(), id: 'b', title: 'B (other tab)', updatedAt: '2026-01-02T00:00:00Z' }
    const aNewer = { ...a, title: 'A edited elsewhere', updatedAt: '2026-01-03T00:00:00Z' }
    const gone = { ...createSession(), id: 'gone', updatedAt: '2026-01-04T00:00:00Z' }
    const merged = mergeStores({ version: 1, selectedId: 'a', sessions: [a] }, { version: 1, selectedId: 'b', sessions: [aNewer, b, gone] }, new Set(['gone']))
    expect(merged.selectedId).toBe('a')
    expect(merged.sessions.map((session) => session.title).sort()).toEqual(['A edited elsewhere', 'B (other tab)'])
  })
})

describe('slide rail drag and drop', () => {
  afterEach(cleanup)

  it('moves a slide forward after the drop target, including to the last position', () => {
    const deck = deckOf({ slides: ['a', 'b', 'c', 'd'].map((id) => ({ id, blocks: [{ type: 'text', text: id }] })) })
    const onMove = vi.fn()
    render(<SlideRail deck={deck} theme={resolveTheme(undefined)} fitScales={{}} activeIndex={0} onSelect={() => undefined} onMove={onMove} />)
    const data = new Map<string, string>()
    const dataTransfer = { setData: (key: string, value: string) => data.set(key, value), getData: (key: string) => data.get(key) ?? '', effectAllowed: '' }
    fireEvent.dragStart(screen.getByRole('button', { name: 'Slide 3' }), { dataTransfer })
    fireEvent.drop(screen.getByRole('button', { name: 'Slide 4' }), { dataTransfer })
    expect(onMove).toHaveBeenCalledWith('c', 'd')
    fireEvent.dragStart(screen.getByRole('button', { name: 'Slide 4' }), { dataTransfer })
    fireEvent.drop(screen.getByRole('button', { name: 'Slide 2' }), { dataTransfer })
    expect(onMove).toHaveBeenLastCalledWith('d', 'a')
  })
})
