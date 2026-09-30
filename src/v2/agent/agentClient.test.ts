import { describe, expect, it, vi } from 'vitest'

import { generate, buildMessages, type AgentConfig } from './agentClient'
import { completedItems, parsePartialJson } from './partialJson'
import { formatDeckContext } from './deckContext'
import { normalizeDeck } from '../domain/normalize'
import { createLogger } from '../../lib/logger'

const config: AgentConfig = { apiUrl: 'http://localhost:7000/v1/chat/completions', agentModel: 'agt-test', requestTimeoutMs: 5_000, idleTimeoutMs: 5_000, maxStreamBytes: 1_000_000 }
const silent = createLogger(() => undefined)

function sse(chunks: string[]): Response {
  const encoder = new TextEncoder()
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk))
      controller.close()
    },
  })
  return new Response(body, { status: 200, headers: { 'Content-Type': 'text/event-stream' } })
}

function toolChunks(name: string, args: string, pieces = 5): string[] {
  const size = Math.ceil(args.length / pieces)
  const chunks: string[] = []
  for (let offset = 0; offset < args.length; offset += size) {
    const first = offset === 0
    const delta = { tool_calls: [{ index: 0, ...(first ? { id: 'call-1', type: 'function' } : {}), function: { ...(first ? { name } : {}), arguments: args.slice(offset, offset + size) } }] }
    chunks.push(`data: ${JSON.stringify({ choices: [{ index: 0, delta, finish_reason: null }] })}\n\n`)
  }
  chunks.push(`data: ${JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }] })}\n\n`, 'data: [DONE]\n\n')
  return chunks
}

const deckArgs = JSON.stringify({
  title: 'Solar',
  theme: { preset: 'ocean' },
  slides: [
    { id: 'cover', align: 'center', blocks: [{ type: 'heading', text: 'Solar wins', level: 1 }] },
    { id: 'data', blocks: [{ type: 'chart', kind: 'column', labels: ['2020', '2024'], series: [{ name: 'GW', values: [700, 1600] }] }] },
    { id: 'close', blocks: [{ type: 'text', text: 'Thanks' }] },
  ],
})

describe('partial JSON', () => {
  it('parses streaming prefixes and reports completed items only', () => {
    const cut = deckArgs.slice(0, deckArgs.indexOf('"id":"close"'))
    const { value } = parsePartialJson(cut)
    expect((value as { title: string }).title).toBe('Solar')
    expect(completedItems(cut, 'slides')).toHaveLength(2)
    expect(completedItems(deckArgs, 'slides')).toHaveLength(3)
  })

  it('never returns a half-written number', () => {
    expect(parsePartialJson('{"a": 12').value).toEqual({})
    expect(parsePartialJson('{"a": 12,').value).toEqual({ a: 12 })
  })
})

describe('v2 agent client', () => {
  it('streams a create_presentation call with progressive previews', async () => {
    const previews: number[] = []
    const fetchMock = vi.fn(async () => sse(toolChunks('create_presentation', deckArgs, 12)))
    const result = await generate({ prompt: 'Solar deck', config, deck: null, onPreview: (_deck, ready) => previews.push(ready) }, { fetch: fetchMock as never, logger: silent })
    expect(result.ok && result.kind === 'deck' && result.created).toBe(true)
    if (!result.ok || result.kind !== 'deck') throw new Error('expected a deck')
    expect(result.deck.slides.map((slide) => slide.id)).toEqual(['cover', 'data', 'close'])
    expect(previews[previews.length - 1]).toBe(3)
    const body = JSON.parse((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body as string)
    expect(body).toMatchObject({ model: 'agt-test', stream: true })
    expect(body.messages[0].role).toBe('system')
    expect(body.messages[body.messages.length - 1]).toEqual({ role: 'user', content: 'Solar deck' })
  })

  it('applies edit operations to the current deck and reports partial failures', async () => {
    const deck = normalizeDeck(JSON.parse(deckArgs)).deck!
    const args = JSON.stringify({ operations: [
      { op: 'update_block', blockId: 'cover-b1', set: { text: 'Solar ==wins==' } },
      { op: 'remove_slides', slideIds: ['missing'] },
    ] })
    const result = await generate({ prompt: 'edit', config, deck }, { fetch: (async () => sse(toolChunks('edit_presentation', args))) as never, logger: silent })
    if (!result.ok || result.kind !== 'deck') throw new Error('expected a deck')
    expect(result.created).toBe(false)
    expect(result.appliedOperations).toBe(1)
    expect(result.failedOperations).toEqual([{ message: 'Slide "missing" does not exist.' }])
    expect(result.deck.slides[0].blocks[0].text).toBe('Solar ==wins==')
  })

  it('returns plain text answers as messages', async () => {
    const chunks = [`data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: 'Which slide do you mean?' } }] })}\n\n`, 'data: [DONE]\n\n']
    const result = await generate({ prompt: 'fix it', config, deck: null }, { fetch: (async () => sse(chunks)) as never, logger: silent })
    expect(result).toMatchObject({ ok: true, kind: 'message', message: 'Which slide do you mean?' })
  })

  it('fails without applying anything when the stream is incomplete', async () => {
    const chunks = toolChunks('create_presentation', deckArgs).slice(0, 3)
    const result = await generate({ prompt: 'x', config, deck: null }, { fetch: (async () => sse(chunks)) as never, logger: silent })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.category).toBe('stream-corruption')
  })

  it('maps HTTP failures', async () => {
    const result = await generate({ prompt: 'x', config, deck: null }, { fetch: (async () => new Response('nope', { status: 429 })) as never, logger: silent })
    expect(!result.ok && result.error.category).toBe('rate-limit')
  })
})

describe('deck context', () => {
  it('lists slides and blocks by id with props, the focus and fit feedback', () => {
    const deck = normalizeDeck(JSON.parse(deckArgs)).deck!
    const text = formatDeckContext(deck, { focusedSlideId: 'data', fitScales: { data: 0.8 } })
    expect(text).toContain('## slide 2 · id data')
    expect(text).toContain('- data-b1 chart {"kind":"column"')
    expect(text).toContain('Focused slide: data (slide 2)')
    expect(text).toContain('content scaled to 80% to fit')
  })

  it('falls back to outlines for large decks', () => {
    const big = normalizeDeck({ slides: Array.from({ length: 40 }, (_, index) => ({ blocks: [{ type: 'text', text: `Slide ${index} ${'long text '.repeat(40)}` }] })) }).deck!
    const text = formatDeckContext(big, { maxChars: 8_000 })
    expect(text.length).toBeLessThanOrEqual(8_000)
    expect(text).toContain('slideCount: 40')
  })

  it('builds system, bounded history and prompt messages', () => {
    const messages = buildMessages({ prompt: 'now', config, deck: null, history: Array.from({ length: 20 }, (_, index) => ({ role: index % 2 ? 'assistant' : 'user', content: `m${index}` })) })
    expect(messages).toHaveLength(14)
    expect(messages[0].content).toContain('Current presentation: none yet')
    expect(messages[messages.length - 1]).toEqual({ role: 'user', content: 'now' })
  })
})
