import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { AppConfig } from '../config'
import type { ValidatedPresentationConfig } from '../domain/presentationTypes'
import { createLogger } from '../lib/logger'
import { getAppConfig } from '../config'
import { DECK_CONTEXT_MAX_CHARS } from './deckContextFormatter'
import { generatePresentation } from './agentClient'
import {
  backendCreateDeckToolArguments,
  backendCreateDeckToolCallChunk,
  presentationToolArguments,
  publicCompletionsStreamingToolCallChunk,
  sseData,
} from './__fixtures__/publicCompletionsToolCalls'

const config: AppConfig = {
  apiUrl: 'https://agent.example.test/generate',
  agentModel: 'presentation-model',
  requestTimeoutMs: 1_000,
  idleTimeoutMs: 500,
  maxStreamBytes: 10_000,
}

function streamFromText(text: string): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(text))
      controller.close()
    },
  })
}

function sseDelta(content: string): string {
  return `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`
}

function validPresentationText(): string {
  return JSON.stringify({ slides: [{ title: 'Safe title', content: 'Safe text' }], plugins: ['highlight'] })
}

const silentLogger = createLogger(() => undefined)

const deckState: ValidatedPresentationConfig = {
  slides: [
    { title: 'Intro', content: 'Safe intro' },
    { title: 'Pricing', content: 'Safe pricing' },
  ],
  plugins: ['highlight'],
  revealOptions: { transition: 'slide' },
}

function requestBody(fetchMock: ReturnType<typeof vi.fn<typeof fetch>>) {
  const request = fetchMock.mock.calls[0]?.[1] as RequestInit
  return JSON.parse(String(request.body))
}

describe('generatePresentation', () => {
  beforeEach(() => {
    vi.useRealTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('streams valid output, sends model/prompt, and validates before success', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response(streamFromText(`${sseDelta(validPresentationText())}data: [DONE]\n\n`)))
    const onDelta = vi.fn()

    const result = await generatePresentation({ prompt: 'Make slides', config, onDelta }, { fetch: fetchMock, logger: silentLogger })

    expect(result.ok).toBe(true)
    if (result.ok && result.kind !== 'message') expect(result.presentation.slides[0]?.title).toBe('Safe title')
    expect(onDelta).toHaveBeenCalledWith(validPresentationText())
    expect(fetchMock).toHaveBeenCalledWith(config.apiUrl, expect.objectContaining({ method: 'POST' }))
    expect(requestBody(fetchMock)).toEqual({
      model: 'presentation-model',
      messages: [{ role: 'system', content: expect.stringMatching(/^Client context: today is \d{4}-\d{2}-\d{2}/) }, { role: 'user', content: 'Make slides' }],
      stream: true,
    })
  })

  it('preserves no-deck request shape when deckState is omitted or undefined', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response(streamFromText(`${sseDelta(validPresentationText())}data: [DONE]\n\n`)))

    await generatePresentation({ prompt: 'Make slides', config, deckState: undefined }, { fetch: fetchMock, logger: silentLogger })

    expect(requestBody(fetchMock)).toEqual({
      model: 'presentation-model',
      messages: [{ role: 'system', content: expect.stringMatching(/^Client context: today is \d{4}-\d{2}-\d{2}/) }, { role: 'user', content: 'Make slides' }],
      stream: true,
    })
  })

  it('treats null deckState as no deck for initial generation compatibility', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response(streamFromText(`${sseDelta(validPresentationText())}data: [DONE]\n\n`)))

    await generatePresentation({ prompt: 'Make slides', config, deckState: null }, { fetch: fetchMock, logger: silentLogger })

    expect(requestBody(fetchMock)).toEqual({
      model: 'presentation-model',
      messages: [{ role: 'system', content: expect.stringMatching(/^Client context: today is \d{4}-\d{2}-\d{2}/) }, { role: 'user', content: 'Make slides' }],
      stream: true,
    })
  })

  it('prepends bounded deck context before the original user prompt when deckState exists', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response(streamFromText(`${sseDelta(validPresentationText())}data: [DONE]\n\n`)))

    await generatePresentation({ prompt: 'Edit pricing slide', config, deckState }, { fetch: fetchMock, logger: silentLogger })

    const body = requestBody(fetchMock)
    expect(body.model).toBe('presentation-model')
    expect(body.stream).toBe(true)
    expect(body.messages).toHaveLength(2)
    expect(body.messages[0]).toEqual(expect.objectContaining({ role: 'system' }))
    expect(body.messages[0].content).toContain('Current validated deck context')
    expect(body.messages[0].content).toContain('slideIndex: 1')
    expect(body.messages[1]).toEqual({ role: 'user', content: 'Edit pricing slide' })
  })

  it('keeps oversized deck context as a valid system then user message pair', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response(streamFromText(`${sseDelta(validPresentationText())}data: [DONE]\n\n`)))
    const oversizedDeck: ValidatedPresentationConfig = {
      slides: Array.from({ length: 20 }, (_, index) => ({ title: `Slide ${index}`, content: `Safe content ${index} `.repeat(500) })),
    }

    await generatePresentation({ prompt: 'Edit the deck', config, deckState: oversizedDeck }, { fetch: fetchMock, logger: silentLogger })

    const body = requestBody(fetchMock)
    expect(body.messages[0].role).toBe('system')
    expect(body.messages[0].content.split('\n\nClient context:')[0].length).toBeLessThanOrEqual(DECK_CONTEXT_MAX_CHARS)
    expect(body.messages[0].content).toContain('[Deck content truncated: every slide index/title is listed; edit only fields requested by the user.]')
    expect(body.messages[1]).toEqual({ role: 'user', content: 'Edit the deck' })
  })

  it('orders deck context before bounded selected-session context and current prompt last once', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response(streamFromText(`${sseDelta(validPresentationText())}data: [DONE]\n\n`)))
    const conversationContext = Array.from({ length: 18 }, (_, index) => ({
      role: index % 2 === 0 ? 'user' as const : 'assistant' as const,
      content: index === 17 ? 'Edit pricing slide' : `selected-session-${index}`,
    }))

    await generatePresentation({ prompt: 'Edit pricing slide', config, deckState, conversationContext }, { fetch: fetchMock, logger: silentLogger })

    const body = requestBody(fetchMock)
    expect(body.messages[0].role).toBe('system')
    expect(body.messages.at(-1)).toEqual({ role: 'user', content: 'Edit pricing slide' })
    expect(body.messages.filter((message: { content: string }) => message.content === 'Edit pricing slide')).toHaveLength(1)
    expect(body.messages).toHaveLength(17)
    expect(body.messages[1]).toEqual({ role: 'user', content: 'selected-session-2' })
    expect(body.messages.some((message: { content: string }) => message.content.includes('non-selected-session'))).toBe(false)
  })

  it('tells the agent today\'s date so "latest" research uses the right period', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response(streamFromText(`${sseDelta(validPresentationText())}data: [DONE]\n\n`)))

    await generatePresentation({ prompt: 'Latest news', config, deckState, now: () => new Date(2026, 8, 28, 10) }, { fetch: fetchMock, logger: silentLogger })

    const system = requestBody(fetchMock).messages[0]
    expect(system.role).toBe('system')
    expect(system.content).toContain('Current validated deck context')
    expect(system.content).toContain('Client context: today is 2026-09-28')
  })

  it('includes only explicit selected-session context and ignores poisoned localStorage', async () => {
    window.localStorage.setItem('magic-slider:sessions:v1', '{not valid json')
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response(streamFromText(`${sseDelta(validPresentationText())}data: [DONE]\n\n`)))

    await generatePresentation({
      prompt: 'Continue selected',
      config,
      conversationContext: [{ role: 'user', content: 'selected only' }],
    }, { fetch: fetchMock, logger: silentLogger })

    const body = requestBody(fetchMock)
    expect(body.messages).toEqual([
      { role: 'system', content: expect.stringMatching(/^Client context: today is \d{4}-\d{2}-\d{2}/) },
      { role: 'user', content: 'selected only' },
      { role: 'user', content: 'Continue selected' },
    ])
    expect(window.localStorage.getItem('magic-slider:sessions:v1')).toBe('{not valid json')
  })

  it('does not send a placeholder authorization header when no api key is configured', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response(streamFromText(`${sseDelta(validPresentationText())}data: [DONE]\n\n`)))

    await generatePresentation({ prompt: 'Make slides', config }, { fetch: fetchMock, logger: silentLogger })

    const request = fetchMock.mock.calls[0]?.[1] as RequestInit
    expect(request.headers).toEqual({ 'Content-Type': 'application/json' })
  })

  it('sends authorization only when a real api key is configured', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response(streamFromText(`${sseDelta(validPresentationText())}data: [DONE]\n\n`)))

    await generatePresentation({ prompt: 'Make slides', config: { ...config, apiKey: 'real-token' } }, { fetch: fetchMock, logger: silentLogger })

    const request = fetchMock.mock.calls[0]?.[1] as RequestInit
    expect(request.headers).toEqual({ 'Content-Type': 'application/json', Authorization: 'Bearer real-token' })
  })

  it('guards successful responses without readable bodies', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 200 }))

    const result = await generatePresentation({ prompt: 'Make slides', config }, { fetch: fetchMock, logger: silentLogger })

    expect(result).toMatchObject({ ok: false, error: { category: 'stream-corruption' } })
  })

  it.each([
    [401, 'auth'],
    [429, 'rate-limit'],
    [500, 'http'],
  ] as const)('maps HTTP %s to %s', async (status, category) => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response('nope', { status }))

    const result = await generatePresentation({ prompt: 'Make slides', config }, { fetch: fetchMock, logger: silentLogger })

    expect(result).toMatchObject({ ok: false, error: { category } })
  })

  it('maps network failures', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockRejectedValue(new TypeError('offline'))

    const result = await generatePresentation({ prompt: 'Make slides', config }, { fetch: fetchMock, logger: silentLogger })

    expect(result).toMatchObject({ ok: false, error: { category: 'network' } })
  })

  it('maps explicit cancellation without validation or parsing errors', async () => {
    vi.useFakeTimers()
    const abortController = new AbortController()
    const fetchMock = vi.fn<typeof fetch>().mockReturnValue(new Promise(() => undefined) as Promise<Response>)
    const resultPromise = generatePresentation({ prompt: 'Make slides', config, signal: abortController.signal }, { fetch: fetchMock, logger: silentLogger })

    abortController.abort()

    await expect(resultPromise).resolves.toMatchObject({ ok: false, error: { category: 'cancellation' } })
  })

  it('maps total timeout', async () => {
    vi.useFakeTimers()
    const fetchMock = vi.fn<typeof fetch>().mockReturnValue(new Promise(() => undefined) as Promise<Response>)
    const resultPromise = generatePresentation({ prompt: 'Make slides', config }, { fetch: fetchMock, logger: silentLogger })

    await vi.advanceTimersByTimeAsync(config.requestTimeoutMs)

    await expect(resultPromise).resolves.toMatchObject({ ok: false, error: { category: 'timeout' } })
  })

  it('maps idle timeout while waiting for stream data', async () => {
    vi.useFakeTimers()
    const idleBody = new ReadableStream<Uint8Array>({ start() { /* intentionally idle */ } })
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response(idleBody))
    const resultPromise = generatePresentation({ prompt: 'Make slides', config }, { fetch: fetchMock, logger: silentLogger })

    await vi.advanceTimersByTimeAsync(config.idleTimeoutMs)

    await expect(resultPromise).resolves.toMatchObject({ ok: false, error: { category: 'timeout' } })
  })

  it('aborts oversized streams before parsing', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response(streamFromText(sseDelta(validPresentationText()))))

    const result = await generatePresentation({ prompt: 'Make slides', config: { ...config, maxStreamBytes: 10 } }, { fetch: fetchMock, logger: silentLogger })

    expect(result).toMatchObject({ ok: false, error: { category: 'size-limit' } })
  })

  it('maps malformed stream diagnostics', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response(streamFromText('data: {not json}\n\n')))

    const result = await generatePresentation({ prompt: 'Make slides', config }, { fetch: fetchMock, logger: silentLogger })

    expect(result).toMatchObject({ ok: false, error: { category: 'stream-corruption' } })
  })

  it('accepts a completed plain assistant clarification without manufacturing a deck', async () => {
    const text = 'Which slide should receive the new cover image?'
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response(streamFromText(`${sseDelta(text)}data: [DONE]\n\n`)))
    const onAction = vi.fn()

    const result = await generatePresentation({ prompt: 'Replace that image', config, deckState, onAction }, { fetch: fetchMock, logger: silentLogger })

    expect(result).toEqual({ ok: true, kind: 'message', message: text, rawText: text })
    expect(onAction).not.toHaveBeenCalled()
    expect(result).not.toHaveProperty('presentation')
  })

  it('preserves user-facing image warnings alongside successful slide actions', async () => {
    const text = 'Image generation was unavailable, so I used a plain background.'
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response(streamFromText(`${sseDelta(text)}${sseData(backendCreateDeckToolCallChunk)}data: [DONE]\n\n`)))

    const result = await generatePresentation({ prompt: 'Make slides with an original cover', config }, { fetch: fetchMock, logger: silentLogger })

    expect(result).toMatchObject({ ok: true, message: text, presentation: { slides: backendCreateDeckToolArguments.slides } })
  })

  it('bounds plain assistant messages to the local history limit', async () => {
    const text = 'A'.repeat(25_000)
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response(streamFromText(`${sseDelta(text)}data: [DONE]\n\n`)))
    const result = await generatePresentation({ prompt: 'Clarify', config: { ...config, maxStreamBytes: 30_000 } }, { fetch: fetchMock, logger: silentLogger })

    expect(result).toMatchObject({ ok: true, kind: 'message' })
    if (result.ok && result.kind === 'message') {
      expect(result.message).toHaveLength(20_000)
      expect(result.message).toMatch(/response shortened/)
    }
  })

  it('maps malformed final JSON', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response(streamFromText(`${sseDelta('{"slides":')}data: [DONE]\n\n`)))

    const result = await generatePresentation({ prompt: 'Make slides', config }, { fetch: fetchMock, logger: silentLogger })

    expect(result).toMatchObject({ ok: false, error: { category: 'json-parse' } })
  })

  it('rejects invalid and unsafe legacy generated presentations', async () => {
    const unsafe = JSON.stringify({ slides: [{ title: 'Bad', content: '<script>alert(1)</script>' }] })
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response(streamFromText(`${sseDelta(unsafe)}data: [DONE]\n\n`)))

    const result = await generatePresentation({ prompt: 'Make slides', config }, { fetch: fetchMock, logger: silentLogger })

    expect(result).toMatchObject({ ok: false, error: { category: 'unsafe-legacy-content' } })
  })

  it('accumulates public completion tool calls and dispatches validated presentation actions', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response(streamFromText(`${sseData(publicCompletionsStreamingToolCallChunk)}data: [DONE]\n\n`)))
    const onAction = vi.fn()

    const result = await generatePresentation({ prompt: 'Make slides', config, onAction }, { fetch: fetchMock, logger: silentLogger })

    expect(result).toMatchObject({
      ok: true,
      presentation: { ...presentationToolArguments.create_deck, slides: [...presentationToolArguments.create_deck.slides].reverse() },
    })
    expect(onAction).toHaveBeenCalledTimes(5)
    expect(onAction).toHaveBeenCalledWith(expect.objectContaining({ action: 'create_deck' }))
    expect(onAction).toHaveBeenCalledWith(expect.objectContaining({ action: 'add_slide' }))
  })

  it('dispatches backend create_deck tool calls after dropping app-owned reveal options', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response(streamFromText(`${sseData(backendCreateDeckToolCallChunk)}data: [DONE]\n\n`)))
    const onAction = vi.fn()

    const result = await generatePresentation({ prompt: 'Make slides', config, onAction }, { fetch: fetchMock, logger: silentLogger })

    expect(result).toMatchObject({
      ok: true,
      presentation: {
        slides: backendCreateDeckToolArguments.slides,
        plugins: ['notes'],
        revealOptions: { transition: 'slide' },
      },
    })
    expect(result.ok && result.kind !== 'message' && result.presentation.revealOptions).not.toHaveProperty('hash')
    expect(onAction).toHaveBeenCalledTimes(1)
    expect(onAction).toHaveBeenCalledWith(expect.objectContaining({
      action: 'create_deck',
      revealOptions: { transition: 'slide' },
    }))
  })

  it('concatenates chunked function arguments before action validation', async () => {
    const serializedArgs = JSON.stringify(presentationToolArguments.create_deck)
    const firstHalf = serializedArgs.slice(0, 20)
    const secondHalf = serializedArgs.slice(20)
    const firstChunk = {
      choices: [{ delta: { tool_calls: [{ index: 0, id: 'call_create_deck', type: 'function', function: { name: 'create_deck', arguments: firstHalf }, execution: 'client', source: 'schema_only' }] } }],
    }
    const secondChunk = {
      choices: [{ delta: { tool_calls: [{ index: 0, type: 'function', function: { arguments: secondHalf } }] } }],
    }
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response(streamFromText(`${sseData(firstChunk)}${sseData(secondChunk)}data: [DONE]\n\n`)))
    const onAction = vi.fn()

    const result = await generatePresentation({ prompt: 'Make slides', config, onAction }, { fetch: fetchMock, logger: silentLogger })

    expect(result).toMatchObject({ ok: true, presentation: presentationToolArguments.create_deck })
    expect(onAction).toHaveBeenCalledWith(expect.objectContaining({ action: 'create_deck' }))
  })

  it('applies every change from one streamed apply_changes batch in order', async () => {
    const args = JSON.stringify({ changes: [
      { action: 'edit_slide', slideIndex: 1, patch: { title: 'Pricing that scales' } },
      { action: 'add_slide', afterIndex: -1, slide: { layout: 'title', title: 'Welcome' } },
      { action: 'update_deck', theme: 'paper' },
    ] })
    const chunks = [
      { index: 1, id: 'call_batch', type: 'function', function: { name: 'apply_changes', arguments: args.slice(0, 40) } },
      { index: 1, type: 'function', function: { arguments: args.slice(40) } },
    ].map((call) => sseData({ choices: [{ delta: { tool_calls: [call] } }] })).join('')
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response(streamFromText(`${chunks}data: [DONE]\n\n`)))
    const onAction = vi.fn()

    const result = await generatePresentation({ prompt: 'Rename slide 2, add a welcome slide first and use the paper theme', config, deckState, onAction }, { fetch: fetchMock, logger: silentLogger })

    expect(result).toMatchObject({ ok: true, presentation: { theme: 'paper', slides: [{ title: 'Welcome' }, { title: 'Intro' }, { title: 'Pricing that scales' }] } })
    expect(onAction.mock.calls.map(([action]) => action.action)).toEqual(['edit_slide', 'add_slide', 'update_deck'])
  })

  it('assembles fragmented tool names forwarded by the public agent adapter', async () => {
    const chunks = [
      { index: 0, id: 'split-name', function: { name: 'create_', arguments: '' } },
      { index: 0, function: { name: 'deck', arguments: JSON.stringify(presentationToolArguments.create_deck) } },
    ].map((call) => sseData({ choices: [{ delta: { tool_calls: [call] } }] })).join('')
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response(streamFromText(`${chunks}data: [DONE]\n\n`)))

    const result = await generatePresentation({ prompt: 'Make slides', config }, { fetch: fetchMock, logger: silentLogger })

    expect(result).toMatchObject({ ok: true, presentation: presentationToolArguments.create_deck })
  })

  it('allows a quiet image-generation interval before final slide actions with the default timeouts', async () => {
    vi.useFakeTimers()
    let streamController: ReadableStreamDefaultController<Uint8Array> | undefined
    const body = new ReadableStream<Uint8Array>({ start(controller) { streamController = controller } })
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response(body))
    const imageConfig = getAppConfig({ VITE_API_URL: config.apiUrl, VITE_AGENT_MODEL: config.agentModel } as ImportMetaEnv)
    const resultPromise = generatePresentation({ prompt: 'Create slides with a generated image', config: imageConfig }, { fetch: fetchMock, logger: silentLogger })

    await vi.advanceTimersByTimeAsync(90_000)
    const signal = fetchMock.mock.calls[0][1]?.signal
    expect(signal?.aborted).toBe(false)
    streamController?.enqueue(new TextEncoder().encode(`${sseData(backendCreateDeckToolCallChunk)}data: [DONE]\n\n`))
    streamController?.close()

    await expect(resultPromise).resolves.toMatchObject({ ok: true })
  })

  it('reports coalesced tool-only progress before validation and action callbacks', async () => {
    const fragments = JSON.stringify(presentationToolArguments.create_deck).match(/.{1,12}/g) ?? []
    const chunks = fragments.map((fragment, index) => sseData({
      choices: [{ delta: { tool_calls: [{
        index: 0,
        function: { ...(index === 0 ? { name: 'create_deck' } : {}), arguments: fragment },
      }] } }],
    })).join('')
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response(streamFromText(`${chunks}data: [DONE]\n\n`)))
    const callbacks: string[] = []

    const result = await generatePresentation({
      prompt: 'Make slides',
      config,
      onProgress: (message) => callbacks.push(message),
      onAction: () => callbacks.push('action'),
    }, { fetch: fetchMock, logger: silentLogger })

    expect(result.ok).toBe(true)
    expect(callbacks).toEqual([
      'Sending your request…',
      'Receiving slide changes…',
      'Validating your presentation…',
      'action',
    ])
  })

  it('reports text receipt without claiming validation when the response is truncated', async () => {
    const chunks = [...validPresentationText()].map(sseDelta).join('')
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response(streamFromText(chunks)))
    const onProgress = vi.fn()

    const result = await generatePresentation({ prompt: 'Make slides', config, onProgress }, { fetch: fetchMock, logger: silentLogger })

    expect(result).toMatchObject({ ok: false, error: { category: 'stream-corruption' } })
    expect(onProgress.mock.calls.flat()).toEqual(['Sending your request…', 'Receiving presentation content…'])
  })

  it.each(['Sending your request…', 'Receiving slide changes…', 'Validating your presentation…'])('honors cancellation during the %s progress callback', async (cancelAt) => {
    const controller = new AbortController()
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response(streamFromText(`${sseData(backendCreateDeckToolCallChunk)}data: [DONE]\n\n`)))
    const onAction = vi.fn()
    const onProgress = vi.fn((message: string) => {
      if (message === cancelAt) controller.abort()
    })

    const result = await generatePresentation({ prompt: 'Make slides', config, signal: controller.signal, onProgress, onAction }, { fetch: fetchMock, logger: silentLogger })

    expect(result).toMatchObject({ ok: false, error: { category: 'cancellation' } })
    expect(onAction).not.toHaveBeenCalled()
    expect(onProgress).toHaveBeenLastCalledWith(cancelAt)
    expect(fetchMock).toHaveBeenCalledTimes(cancelAt === 'Sending your request…' ? 0 : 1)
  })

  it('returns the final deck for edit-only requests', async () => {
    const action = { index: 0, function: { name: 'edit_slide', arguments: JSON.stringify({ slideIndex: 1, patch: { title: 'New pricing' } }) } }
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response(streamFromText(`${sseData({ choices: [{ delta: { tool_calls: [action] } }] })}data: [DONE]\n\n`)))

    const result = await generatePresentation({ prompt: 'Update pricing', config, deckState }, { fetch: fetchMock, logger: silentLogger })

    expect(result).toMatchObject({ ok: true, presentation: { ...deckState, slides: [deckState.slides[0], { ...deckState.slides[1], title: 'New pricing' }] } })
    expect(deckState.slides[1].title).toBe('Pricing')
  })

  it('rejects a later invalid action before notifying consumers of any actions', async () => {
    const toolCalls = [
      { index: 0, function: { name: 'create_deck', arguments: JSON.stringify(presentationToolArguments.create_deck) } },
      { index: 1, function: { name: 'delete_slide', arguments: JSON.stringify({ slideIndex: 20 }) } },
    ]
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response(streamFromText(`${sseData({ choices: [{ delta: { tool_calls: toolCalls } }] })}data: [DONE]\n\n`)))
    const onAction = vi.fn()

    const result = await generatePresentation({ prompt: 'Make slides', config, onAction }, { fetch: fetchMock, logger: silentLogger })

    expect(result).toMatchObject({ ok: false, error: { category: 'validation' } })
    expect(onAction).not.toHaveBeenCalled()
  })

  it.each(['', 'data: [DONE]\n'])('rejects EOF without a complete completion event (%j)', async (ending) => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response(streamFromText(`${sseData(backendCreateDeckToolCallChunk)}${ending}`)))
    const onAction = vi.fn()

    const result = await generatePresentation({ prompt: 'Make slides', config, onAction }, { fetch: fetchMock, logger: silentLogger })

    expect(result).toMatchObject({ ok: false, error: { category: 'stream-corruption', diagnostics: [{ code: 'missing-completion-marker' }] } })
    expect(onAction).not.toHaveBeenCalled()
  })

  it.each(['error', 'length', 'content_filter'])('rejects %s finish reasons even after a valid deck', async (finishReason) => {
    const finish = sseData({ choices: [{ delta: {}, finish_reason: finishReason }] })
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response(streamFromText(`${sseData(backendCreateDeckToolCallChunk)}${finish}data: [DONE]\n\n`)))
    const onAction = vi.fn()

    const result = await generatePresentation({ prompt: 'Make slides', config, onAction }, { fetch: fetchMock, logger: silentLogger })

    expect(result).toMatchObject({ ok: false, error: { category: 'stream-corruption', diagnostics: [{ code: `stream-${finishReason}` }] } })
    expect(onAction).not.toHaveBeenCalled()
  })

  it('does not fetch when cancelled before the request starts', async () => {
    const controller = new AbortController()
    controller.abort()
    const fetchMock = vi.fn<typeof fetch>()

    const result = await generatePresentation({ prompt: 'Make slides', config, signal: controller.signal }, { fetch: fetchMock, logger: silentLogger })

    expect(result).toMatchObject({ ok: false, error: { category: 'cancellation' } })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('stops consuming same-chunk events after cancellation from a delta callback', async () => {
    const controller = new AbortController()
    const onAction = vi.fn()
    const onDelta = vi.fn(() => controller.abort())
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response(streamFromText(`${sseDelta('Preparing')}${sseDelta(' more')}${sseData(backendCreateDeckToolCallChunk)}data: [DONE]\n\n`)))

    const result = await generatePresentation({ prompt: 'Make slides', config, signal: controller.signal, onDelta, onAction }, { fetch: fetchMock, logger: silentLogger })

    expect(result).toMatchObject({ ok: false, error: { category: 'cancellation' } })
    expect(onDelta).toHaveBeenCalledTimes(1)
    expect(onAction).not.toHaveBeenCalled()
  })

  it('cancels the response and releases its lock when the completion marker arrives', async () => {
    const cancel = vi.fn()
    const body = new ReadableStream<Uint8Array>({
      start(controller) { controller.enqueue(new TextEncoder().encode(`${sseDelta(validPresentationText())}data: [DONE]\n\n`)) },
      cancel,
    })
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response(body))

    const result = await generatePresentation({ prompt: 'Make slides', config }, { fetch: fetchMock, logger: silentLogger })

    expect(result.ok).toBe(true)
    expect(cancel).toHaveBeenCalledTimes(1)
    expect(body.locked).toBe(false)
    expect(fetchMock.mock.calls[0]?.[1]?.signal?.aborted).toBe(true)
  })

  it('times out a stalled HTTP error body and releases its reader', async () => {
    vi.useFakeTimers()
    const cancel = vi.fn()
    const body = new ReadableStream<Uint8Array>({ cancel })
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response(body, { status: 500 }))
    const promise = generatePresentation({ prompt: 'Make slides', config }, { fetch: fetchMock, logger: silentLogger })

    await vi.advanceTimersByTimeAsync(config.idleTimeoutMs)

    await expect(promise).resolves.toMatchObject({ ok: false, error: { category: 'timeout' } })
    expect(cancel).toHaveBeenCalledTimes(1)
    expect(body.locked).toBe(false)
  })

  it('bounds error diagnostics and closes an error body without waiting for EOF', async () => {
    const cancel = vi.fn()
    const body = new ReadableStream<Uint8Array>({
      start(controller) { controller.enqueue(new TextEncoder().encode('x'.repeat(8_000))) },
      cancel,
    })
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response(body, { status: 500 }))

    const result = await generatePresentation({ prompt: 'Make slides', config }, { fetch: fetchMock, logger: silentLogger })

    expect(result).toMatchObject({ ok: false, error: { category: 'http', diagnostics: [{ details: { bodyText: 'x'.repeat(4_096) } }] } })
    expect(cancel).toHaveBeenCalledTimes(1)
    expect(body.locked).toBe(false)
  })
})
