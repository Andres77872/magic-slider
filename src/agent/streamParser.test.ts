import { describe, expect, it } from 'vitest'

import { backendCreateDeckToolCallChunk, publicCompletionsStreamingToolCallChunk, sseData } from './__fixtures__/publicCompletionsToolCalls'
import { parseSseChunk, type SseParseState } from './streamParser'

const initialState = (): SseParseState => ({ buffer: '', done: false })

describe('parseSseChunk', () => {
  it('emits a complete SSE data event and clears the residual buffer', () => {
    const result = parseSseChunk(initialState(), 'data: {"content":"Hello"}\n\n')

    expect(result.events).toEqual([{ type: 'delta', content: 'Hello' }])
    expect(result.state.buffer).toBe('')
    expect(result.state.done).toBe(false)
  })

  it('retains and completes events split across transport chunks exactly once', () => {
    const first = parseSseChunk(initialState(), 'data: {"content":"Hel')
    expect(first.events).toEqual([])
    expect(first.state.buffer).toBe('data: {"content":"Hel')

    const second = parseSseChunk(first.state, 'lo"}\n\n')
    expect(second.events).toEqual([{ type: 'delta', content: 'Hello' }])
    expect(second.state.buffer).toBe('')
  })

  it('ignores comments and heartbeats without reporting corrupt data', () => {
    const result = parseSseChunk(initialState(), ': keep-alive\n\nevent: ping\ndata: {}\n\n')

    expect(result.events).toEqual([])
    expect(result.state.buffer).toBe('')
  })

  it('emits a typed diagnostic for malformed event payloads', () => {
    const result = parseSseChunk(initialState(), 'data: {not-json}\n\n')

    expect(result.events).toEqual([
      expect.objectContaining({ type: 'diagnostic', reason: 'malformed-json' }),
    ])
  })

  it('marks parsing complete on the [DONE] completion marker', () => {
    const result = parseSseChunk(initialState(), 'data: [DONE]\n\n')

    expect(result.events).toEqual([{ type: 'done' }])
    expect(result.state.done).toBe(true)
    expect(result.state.buffer).toBe('')
  })

  it('handles residual data deterministically after completion', () => {
    const done = parseSseChunk(initialState(), 'data: [DONE]\n\n')
    const afterDone = parseSseChunk(done.state, 'data: {"content":"stale"}\n\n')

    expect(afterDone.events).toEqual([])
    expect(afterDone.state).toEqual(done.state)
  })

  it('emits OpenAI delta.tool_calls with additive schema-only metadata intact', () => {
    const result = parseSseChunk(initialState(), sseData(publicCompletionsStreamingToolCallChunk))

    expect(result.events).toEqual([
      {
        type: 'tool_call',
        toolCalls: publicCompletionsStreamingToolCallChunk.choices[0].delta.tool_calls,
        raw: publicCompletionsStreamingToolCallChunk,
      },
    ])
    const [event] = result.events
    expect(event?.type).toBe('tool_call')
    if (event?.type !== 'tool_call') throw new Error('Expected tool_call event')
    expect(event.toolCalls[0]).toMatchObject({
      function: { name: 'create_deck' },
      execution: 'client',
      source: 'schema_only',
    })
  })

  it('emits the backend create_deck tool_call shape with metadata intact', () => {
    const result = parseSseChunk(initialState(), `${sseData(backendCreateDeckToolCallChunk)}data: [DONE]\n\n`)

    expect(result.events.map((event) => event.type)).toEqual(['tool_call', 'done'])
    const [event] = result.events
    expect(event?.type).toBe('tool_call')
    if (event?.type !== 'tool_call') throw new Error('Expected tool_call event')
    expect(event.raw).toEqual(backendCreateDeckToolCallChunk)
    expect(event.toolCalls).toHaveLength(1)
    expect(event.toolCalls[0]).toMatchObject({
      id: 'call_create_deck_real',
      function: { name: 'create_deck' },
      execution: 'client',
      source: 'schema_only',
    })
  })

  it('keeps content deltas and tool-call deltas in stream order', () => {
    const result = parseSseChunk(
      initialState(),
      `${sseData({ choices: [{ delta: { content: 'Preparing deck' } }] })}${sseData(publicCompletionsStreamingToolCallChunk)}`,
    )

    expect(result.events.map((event) => event.type)).toEqual(['delta', 'tool_call'])
  })

  it.each(['\n', '\r\n', '\r'])('handles %j line endings split at every transport boundary', (ending) => {
    const source = `data: {"content":"Hello"}${ending}${ending}data: [DONE]${ending}${ending}`
    for (let split = 1; split < source.length; split++) {
      const first = parseSseChunk(initialState(), source.slice(0, split))
      const second = parseSseChunk(first.state, source.slice(split))
      expect([...first.events, ...second.events]).toEqual([{ type: 'delta', content: 'Hello' }, { type: 'done' }])
      expect(second.state.done).toBe(true)
    }
  })

  it('joins multiline data and preserves text when a chunk also carries tool calls', () => {
    const toolCall = { index: 0, function: { name: 'create_deck', arguments: '{}' } }
    const payload = { choices: [{ delta: { content: 'Ready', tool_calls: [toolCall] } }] }
    const multiline = JSON.stringify(payload, null, 2).split('\n').map((line) => `data: ${line}`).join('\n')

    const result = parseSseChunk(initialState(), `${multiline}\n\n`)

    expect(result.events.map((event) => event.type)).toEqual(['delta', 'tool_call'])
    expect(result.events[0]).toEqual({ type: 'delta', content: 'Ready' })
  })

  it('accepts complete message tool calls without streaming indexes', () => {
    const toolCall = { id: 'call-edit', type: 'function', function: { name: 'edit_slide', arguments: '{}' } }
    const result = parseSseChunk(initialState(), sseData({ choices: [{ message: { tool_calls: [toolCall] } }] }))

    expect(result.events).toEqual([{ type: 'tool_call', toolCalls: [expect.objectContaining({ ...toolCall, index: 0 })], raw: expect.any(Object) }])
  })

  it.each([
    { index: -1, function: {} },
    { index: 0.5, function: {} },
    { function: {} },
    { index: 0, function: null },
    { index: 0, function: { arguments: { slides: [] } } },
    { index: 0, function: { name: 42 } },
  ])('rejects malformed tool deltas (%j)', (toolCall) => {
    const result = parseSseChunk(initialState(), sseData({ choices: [{ delta: { tool_calls: [toolCall] } }] }))

    expect(result.events).toEqual([expect.objectContaining({ type: 'diagnostic', reason: 'malformed-tool-call' })])
  })

  it('preserves ID-only tool fragments and content with null tool_calls', () => {
    const result = parseSseChunk(initialState(), `${sseData({ choices: [{ delta: { tool_calls: [{ index: 0, id: 'call-1' }] } }] })}${sseData({ choices: [{ delta: { content: 'Working', tool_calls: null } }] })}`)

    expect(result.events).toEqual([
      expect.objectContaining({ type: 'tool_call', toolCalls: [expect.objectContaining({ index: 0, id: 'call-1' })] }),
      { type: 'delta', content: 'Working' },
    ])
  })

  it.each([
    sseData({ error: { message: 'Backend failure' } }),
    'event: error\ndata: Backend failure\n\n',
    sseData({ choices: [{ finish_reason: 'error' }] }),
  ])('emits a provider failure for error envelopes and explicit error events', (source) => {
    expect(parseSseChunk(initialState(), source).events).toEqual([expect.objectContaining({ type: 'stream_error', finishReason: 'error' })])
  })
})
