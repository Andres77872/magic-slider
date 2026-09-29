export interface SseParseState {
  buffer: string
  done: boolean
  skipNextLf?: boolean
}

export interface OpenAiToolCallDelta {
  index: number
  id?: string
  type: 'function'
  function: {
    name?: string
    arguments?: string
  }
  execution?: 'client' | 'server' | string
  source?: 'schema_only' | 'callable' | string
}

type ToolCallExtraction =
  | { kind: 'absent' }
  | { kind: 'valid'; toolCalls: OpenAiToolCallDelta[] }
  | { kind: 'malformed' }

export type SseEvent =
  | { type: 'delta'; content: string }
  | { type: 'tool_call'; toolCalls: OpenAiToolCallDelta[]; raw: unknown }
  | { type: 'stream_error'; finishReason: 'error' | 'length' | 'content_filter'; raw: unknown }
  | { type: 'done' }
  | { type: 'diagnostic'; reason: 'malformed-json' | 'unsupported-event' | 'empty-data' | 'malformed-tool-call'; raw: string }

export interface SseParseResult {
  state: SseParseState
  events: SseEvent[]
}

function extractContent(payload: unknown): string | undefined {
  if (payload && typeof payload === 'object') {
    const record = payload as Record<string, unknown>
    if (typeof record.content === 'string') return record.content
    if (typeof record.delta === 'string') return record.delta

    const choices = record.choices
    if (Array.isArray(choices)) {
      const first = choices[0] as Record<string, unknown> | undefined
      const delta = first?.delta as Record<string, unknown> | undefined
      const message = first?.message as Record<string, unknown> | undefined
      if (typeof delta?.content === 'string') return delta.content
      if (typeof message?.content === 'string') return message.content
      if (typeof first?.text === 'string') return first.text
    }
  }

  return undefined
}

function extractFinishReason(payload: unknown): string | undefined {
  if (!payload || typeof payload !== 'object') return undefined
  const record = payload as Record<string, unknown>
  const choices = record.choices
  if (!Array.isArray(choices)) return undefined

  const first = choices[0] as Record<string, unknown> | undefined
  return typeof first?.finish_reason === 'string' ? first.finish_reason : undefined
}

function normalizeToolCallDelta(value: unknown, fallbackIndex?: number): OpenAiToolCallDelta | null {
  if (!value || typeof value !== 'object') return null
  const record = value as Record<string, unknown>
  const fn = record.function === undefined ? {} : record.function
  const index = record.index ?? fallbackIndex

  if (typeof index !== 'number' || !Number.isSafeInteger(index) || index < 0) return null
  if (record.type !== undefined && record.type !== 'function') return null
  if (!fn || typeof fn !== 'object' || Array.isArray(fn)) return null

  const functionRecord = fn as Record<string, unknown>
  if (['name', 'arguments'].some((key) => functionRecord[key] !== undefined && typeof functionRecord[key] !== 'string')) return null
  if (['id', 'execution', 'source'].some((key) => record[key] !== undefined && typeof record[key] !== 'string')) return null

  return {
    index,
    id: typeof record.id === 'string' ? record.id : undefined,
    type: 'function',
    function: {
      name: typeof functionRecord.name === 'string' ? functionRecord.name : undefined,
      arguments: typeof functionRecord.arguments === 'string' ? functionRecord.arguments : undefined,
    },
    execution: typeof record.execution === 'string' ? record.execution : undefined,
    source: typeof record.source === 'string' ? record.source : undefined,
  }
}

function hasOwnToolCalls(record: Record<string, unknown> | undefined): record is Record<string, unknown> {
  return Boolean(record && Object.prototype.hasOwnProperty.call(record, 'tool_calls'))
}

function extractToolCalls(payload: unknown): ToolCallExtraction {
  if (!payload || typeof payload !== 'object') return { kind: 'absent' }
  const record = payload as Record<string, unknown>
  const choices = record.choices
  if (!Array.isArray(choices)) return { kind: 'absent' }

  const first = choices[0] as Record<string, unknown> | undefined
  const delta = first?.delta as Record<string, unknown> | undefined
  const message = first?.message as Record<string, unknown> | undefined
  const toolCalls = hasOwnToolCalls(delta)
    ? delta.tool_calls
    : hasOwnToolCalls(message)
      ? message.tool_calls
      : undefined

  if (toolCalls === undefined || toolCalls === null) return { kind: 'absent' }
  if (!Array.isArray(toolCalls)) return { kind: 'malformed' }

  const normalized: OpenAiToolCallDelta[] = []
  for (const [index, toolCall] of toolCalls.entries()) {
    const normalizedToolCall = normalizeToolCallDelta(toolCall, hasOwnToolCalls(delta) ? undefined : index)
    if (!normalizedToolCall) {
      // A single SSE event cannot safely emit both valid progress and a fatal
      // diagnostic with the current event model. Preserve corruption visibility
      // for mixed arrays instead of silently accepting partial bad tool-call data.
      return { kind: 'malformed' }
    }
    normalized.push(normalizedToolCall)
  }

  return { kind: 'valid', toolCalls: normalized }
}

function parseEventBlock(block: string): SseEvent[] {
  const lines = block.split('\n')
  const dataLines: string[] = []
  let eventType = ''

  for (const line of lines) {
    if (line.startsWith(':')) continue
    const colon = line.indexOf(':')
    const field = colon < 0 ? line : line.slice(0, colon)
    const value = colon < 0 ? '' : line.slice(colon + 1).replace(/^ /, '')
    if (field === 'event') eventType = value
    if (field === 'data') dataLines.push(value)
  }

  if (dataLines.length === 0) return []

  const raw = dataLines.join('\n').trim()
  if (eventType === 'error') return [{ type: 'stream_error', finishReason: 'error', raw }]
  if (raw === '') return [{ type: 'diagnostic', reason: 'empty-data', raw }]
  if (raw === '[DONE]') return [{ type: 'done' }]

  try {
    const parsed = JSON.parse(raw) as unknown
    const finishReason = extractFinishReason(parsed)
    if (finishReason === 'error' || finishReason === 'length' || finishReason === 'content_filter') {
      return [{ type: 'stream_error', finishReason, raw: parsed }]
    }
    if (parsed && typeof parsed === 'object' && 'error' in parsed && parsed.error != null) {
      return [{ type: 'stream_error', finishReason: 'error', raw: parsed }]
    }

    const extracted = extractToolCalls(parsed)
    if (extracted.kind === 'malformed') {
      return [{ type: 'diagnostic', reason: 'malformed-tool-call', raw }]
    }

    const events: SseEvent[] = []
    const content = extractContent(parsed)
    if (content) events.push({ type: 'delta', content })
    if (extracted.kind === 'valid' && extracted.toolCalls.length > 0) {
      events.push({ type: 'tool_call', toolCalls: extracted.toolCalls, raw: parsed })
    }
    return events
  } catch {
    return [{ type: 'diagnostic', reason: 'malformed-json', raw }]
  }
}

export function parseSseChunk(state: SseParseState, chunk: string): SseParseResult {
  if (state.done) return { state, events: [] }
  if (chunk === '') return { state, events: [] }

  const events: SseEvent[] = []
  // SSE accepts LF, CRLF, and CR. A CRLF pair can straddle transport chunks.
  const nextChunk = state.skipNextLf && chunk.startsWith('\n') ? chunk.slice(1) : chunk
  const combined = `${state.buffer}${nextChunk.replace(/\r\n?/g, '\n')}`
  const parts = combined.split('\n\n')
  const completeBlocks = parts.slice(0, -1)
  const residual = parts[parts.length - 1] ?? ''

  for (const block of completeBlocks) {
    if (block.trim() === '') continue
    for (const event of parseEventBlock(block)) {
      events.push(event)
      if (event.type === 'done') {
        return { state: { buffer: '', done: true }, events }
      }
    }
  }

  return { state: { buffer: residual, done: false, skipNextLf: chunk.endsWith('\r') }, events }
}
