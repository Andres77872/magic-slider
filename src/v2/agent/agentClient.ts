import { parseSseChunk, type OpenAiToolCallDelta, type SseParseState } from '../../agent/streamParser'
import { createAppError, type GenerationError } from '../../lib/errors'
import { logger as defaultLogger, type Logger } from '../../lib/logger'
import type { Deck } from '../domain/deckSchema'
import { normalizeDeck, type DeckDiagnostic } from '../domain/normalize'
import { applyOperations, parseOperations } from '../domain/operations'
import { CREATE_TOOL, EDIT_TOOL, TOOL_ALIASES } from './contract'
import { clientContextLine, formatDeckContext } from './deckContext'
import { parsePartialJson, completedItems } from './partialJson'

export interface AgentConfig {
  apiUrl: string
  agentModel: string
  apiKey?: string
  requestTimeoutMs: number
  idleTimeoutMs: number
  maxStreamBytes: number
}

export type ChatTurn = { role: 'user' | 'assistant'; content: string }

export type GenerationPhase = 'sending' | 'thinking' | 'writing' | 'building' | 'validating'

export interface GenerateInput {
  prompt: string
  config: AgentConfig
  deck: Deck | null
  history?: ChatTurn[]
  focusedSlideId?: string | null
  fitScales?: Readonly<Record<string, number>>
  signal?: AbortSignal
  onPhase?: (phase: GenerationPhase, detail?: string) => void
  /** Progressive preview while create_presentation arguments stream in. */
  onPreview?: (deck: Deck, slidesReady: number) => void
  onText?: (text: string) => void
  now?: () => Date
}

export interface FailedOperation {
  message: string
}

export type GenerateResult =
  | {
    ok: true
    kind: 'deck'
    deck: Deck
    created: boolean
    appliedOperations: number
    failedOperations: FailedOperation[]
    diagnostics: DeckDiagnostic[]
    message?: string
    rawText: string
  }
  | { ok: true; kind: 'message'; message: string; rawText: string }
  | { ok: false; error: GenerationError; rawText: string; partialDeck?: Deck }

export const HISTORY_LIMIT = 12
const PREVIEW_INTERVAL_MS = 350

type PendingCall = { index: number; id?: string; name: string; arguments: string }

function mergeDelta(pending: Map<number, PendingCall>, delta: OpenAiToolCallDelta): PendingCall {
  const existing = pending.get(delta.index)
  const next: PendingCall = {
    index: delta.index,
    id: delta.id ?? existing?.id,
    name: delta.function.name === undefined ? existing?.name ?? '' : `${existing?.name ?? ''}${delta.function.name}`,
    arguments: `${existing?.arguments ?? ''}${delta.function.arguments ?? ''}`,
  }
  pending.set(delta.index, next)
  return next
}

function generationError(category: GenerationError['category'], code: string, message: string, details?: unknown, cause?: unknown): GenerationError {
  return createAppError({ category, diagnostics: [{ code, message, details }], cause }) as GenerationError
}

export function buildMessages(input: GenerateInput): Array<{ role: 'system' | 'user' | 'assistant'; content: string }> {
  const system = [
    input.deck ? formatDeckContext(input.deck, { focusedSlideId: input.focusedSlideId, fitScales: input.fitScales }) : 'Current presentation: none yet. Create one with create_presentation.',
    clientContextLine(input.now?.() ?? new Date()),
  ].join('\n\n')
  const history = (input.history ?? [])
    .filter((turn) => (turn.role === 'user' || turn.role === 'assistant') && turn.content.trim())
    .slice(-HISTORY_LIMIT)
  return [{ role: 'system', content: system }, ...history, { role: 'user', content: input.prompt }]
}

function isDeckPayload(value: unknown): boolean {
  return Boolean(value) && typeof value === 'object' && ['slides', 'operations', 'op', 'blocks'].some((key) => key in (value as object))
}

/** Plain assistant text, excluding a pasted deck or tool payload (not ordinary text that merely starts with "[" or "`"). */
function assistantText(raw: string): string | undefined {
  const text = raw.trim()
  if (!text) return undefined
  try {
    const parsed = JSON.parse(text)
    if (parsed && typeof parsed === 'object') return undefined
  } catch {
    // Not a bare JSON value: keep checking for a fenced payload.
  }
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text)?.[1]
  if (fenced) {
    try {
      if (isDeckPayload(JSON.parse(fenced))) return undefined
    } catch {
      // A fenced snippet that is not JSON is ordinary text.
    }
  }
  return text.length > 2_000 ? `${text.slice(0, 1_990)}…` : text
}

function parseArguments(call: PendingCall): { ok: true; value: unknown } | { ok: false; message: string } {
  try {
    return { ok: true, value: JSON.parse(call.arguments || '{}') }
  } catch (cause) {
    return { ok: false, message: `The ${call.name} arguments were not valid JSON (${String(cause).slice(0, 120)}).` }
  }
}

function extractJsonDeck(raw: string): unknown | null {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1] ?? raw
  const start = fenced.indexOf('{')
  const end = fenced.lastIndexOf('}')
  if (start === -1 || end <= start) return null
  try {
    const value = JSON.parse(fenced.slice(start, end + 1))
    return value && typeof value === 'object' && 'slides' in value && !('op' in value) && !('operations' in value) ? value : null
  } catch {
    return null
  }
}

/** Applies the finished tool calls, in order, to the current deck. */
export function applyToolCalls(deck: Deck | null, calls: ReadonlyArray<{ name: string; arguments: string }>): {
  deck: Deck | null
  created: boolean
  appliedOperations: number
  failedOperations: FailedOperation[]
  diagnostics: DeckDiagnostic[]
} {
  let current = deck
  let created = false
  let appliedOperations = 0
  const failedOperations: FailedOperation[] = []
  const diagnostics: DeckDiagnostic[] = []

  for (const [index, call] of calls.entries()) {
    const tool = TOOL_ALIASES[call.name]
    const parsed = parseArguments({ index, name: call.name, arguments: call.arguments })
    if (!tool) {
      diagnostics.push({ severity: 'warning', path: call.name, message: `Ignored an unknown tool call "${call.name.slice(0, 40)}".` })
      continue
    }
    if (!parsed.ok) {
      failedOperations.push({ message: parsed.message })
      continue
    }
    if (tool === CREATE_TOOL) {
      const result = normalizeDeck(parsed.value)
      diagnostics.push(...result.diagnostics)
      if (result.deck) {
        current = result.deck
        created = true
      } else {
        failedOperations.push({ message: 'The generated presentation had no valid slides.' })
      }
      continue
    }
    if (tool === EDIT_TOOL) {
      if (!current) {
        failedOperations.push({ message: 'There is no presentation to edit yet.' })
        continue
      }
      const { operations, failed } = parseOperations(parsed.value)
      failedOperations.push(...failed.map((failure) => ({ message: `Malformed operation: ${failure.message}` })))
      const applied = applyOperations(current, operations)
      current = applied.deck
      appliedOperations += applied.applied.length
      failedOperations.push(...applied.failed.map((failure) => ({ message: failure.message })))
      diagnostics.push(...applied.diagnostics.filter((diagnostic) => diagnostic.severity !== 'error'))
    }
  }
  return { deck: current, created, appliedOperations, failedOperations, diagnostics }
}

export async function generate(input: GenerateInput, deps: { fetch?: typeof fetch; logger?: Logger } = {}): Promise<GenerateResult> {
  const fetchImpl = deps.fetch ?? fetch
  const log = deps.logger ?? defaultLogger
  const controller = new AbortController()
  let abortReason: 'cancellation' | 'timeout' | undefined
  let rawText = ''
  let bytes = 0
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined
  const pending = new Map<number, PendingCall>()
  let lastPreviewAt = 0
  let previewSlides = 0
  let partialDeck: Deck | undefined
  let phase: GenerationPhase | null = null

  const setPhase = (next: GenerationPhase, detail?: string) => {
    if (phase === next && !detail) return
    phase = next
    input.onPhase?.(next, detail)
  }
  const abortFromParent = () => {
    if (!controller.signal.aborted) {
      abortReason = 'cancellation'
      controller.abort()
    }
  }
  if (input.signal?.aborted) abortFromParent()
  input.signal?.addEventListener('abort', abortFromParent, { once: true })
  const abortForTimeout = () => {
    if (!controller.signal.aborted) {
      abortReason = 'timeout'
      controller.abort()
    }
  }
  let idleTimer = setTimeout(abortForTimeout, input.config.idleTimeoutMs)
  const totalTimer = setTimeout(abortForTimeout, input.config.requestTimeoutMs)
  const resetIdle = () => {
    clearTimeout(idleTimer)
    idleTimer = setTimeout(abortForTimeout, input.config.idleTimeoutMs)
  }

  const maybePreview = (call: PendingCall, force = false) => {
    if (!input.onPreview || TOOL_ALIASES[call.name] !== CREATE_TOOL) return
    const now = Date.now()
    if (!force && now - lastPreviewAt < PREVIEW_INTERVAL_MS) return
    const slides = completedItems(call.arguments, 'slides')
    if (slides.length <= previewSlides) return
    lastPreviewAt = now
    const partial = parsePartialJson(call.arguments).value
    const meta = partial && typeof partial === 'object' ? partial as Record<string, unknown> : {}
    const { deck } = normalizeDeck({ title: meta.title, language: meta.language, theme: meta.theme, settings: meta.settings, slides })
    if (!deck) return
    previewSlides = slides.length
    partialDeck = deck
    setPhase('building', `${slides.length} slide${slides.length === 1 ? '' : 's'} ready`)
    input.onPreview(deck, slides.length)
  }

  /** Keeps the latest finished slides available to the caller when the stream fails. */
  const flushPreview = () => {
    for (const call of pending.values()) maybePreview(call, true)
    return partialDeck
  }

  try {
    setPhase('sending')
    const headers: Record<string, string> = { 'Content-Type': 'application/json', Accept: 'text/event-stream' }
    if (input.config.apiKey) headers.Authorization = `Bearer ${input.config.apiKey}`
    const response = await fetchImpl(input.config.apiUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify({ model: input.config.agentModel, messages: buildMessages(input), stream: true }),
      signal: controller.signal,
    })
    resetIdle()

    if (!response.ok) {
      let bodyText = ''
      try {
        bodyText = (await response.text()).slice(0, 4_096)
      } catch {
        bodyText = ''
      }
      const category = response.status === 401 || response.status === 403 ? 'auth' : response.status === 429 ? 'rate-limit' : 'http'
      const error = generationError(category, 'http-status', `Agent endpoint returned HTTP ${response.status}.`, { status: response.status, bodyText })
      log.error('v2 agent endpoint returned an unsuccessful response.', { status: response.status }, error)
      return { ok: false, error, rawText }
    }
    if (!response.body) {
      return { ok: false, error: generationError('stream-corruption', 'missing-body', 'The agent response had no body.'), rawText }
    }

    setPhase('thinking')
    reader = response.body.getReader()
    const decoder = new TextDecoder()
    let state: SseParseState = { buffer: '', done: false }
    while (!state.done) {
      const { done, value } = await reader.read()
      if (done) break
      resetIdle()
      bytes += value.byteLength
      if (bytes > input.config.maxStreamBytes) {
        controller.abort()
        return { ok: false, error: createAppError({ category: 'size-limit' }) as GenerationError, rawText, partialDeck: flushPreview() }
      }
      const parsed = parseSseChunk(state, decoder.decode(value, { stream: true }))
      state = parsed.state
      for (const event of parsed.events) {
        if (event.type === 'delta') {
          rawText += event.content
          setPhase('writing')
          input.onText?.(rawText)
        } else if (event.type === 'tool_call') {
          for (const delta of event.toolCalls) {
            const call = mergeDelta(pending, delta)
            if (phase !== 'building') setPhase('writing')
            maybePreview(call)
          }
        } else if (event.type === 'stream_error') {
          const error = generationError('stream-corruption', `stream-${event.finishReason}`, 'The agent did not complete the generation.', event.raw)
          log.error('v2 agent stream did not complete.', { finishReason: event.finishReason }, error)
          return { ok: false, error, rawText, partialDeck: flushPreview() }
        } else if (event.type === 'diagnostic') {
          const error = generationError('stream-corruption', event.reason, 'Malformed streamed agent event.', event.raw)
          return { ok: false, error, rawText, partialDeck: flushPreview() }
        }
      }
    }

    if (controller.signal.aborted) throw new DOMException('Aborted', 'AbortError')
    if (!state.done) {
      return { ok: false, error: generationError('stream-corruption', 'missing-completion-marker', 'The agent stream ended before [DONE].'), rawText, partialDeck: flushPreview() }
    }

    setPhase('validating')
    const calls = [...pending.values()].sort((left, right) => left.index - right.index)
    for (const call of calls) maybePreview(call, true)
    const text = assistantText(rawText)

    if (!calls.length) {
      // A deck pasted as text only ever creates a presentation; it never replaces an existing one.
      const fallback = input.deck ? null : extractJsonDeck(rawText)
      if (fallback) {
        const result = normalizeDeck(fallback)
        if (result.deck) {
          return { ok: true, kind: 'deck', deck: result.deck, created: true, appliedOperations: 0, failedOperations: [], diagnostics: result.diagnostics, rawText }
        }
      }
      if (text) return { ok: true, kind: 'message', message: text, rawText }
      return { ok: false, error: generationError('validation', 'empty-response', 'The agent returned neither a presentation nor a message.'), rawText }
    }

    const applied = applyToolCalls(input.deck, calls)
    if (!applied.deck || (!applied.created && applied.appliedOperations === 0)) {
      const reasons = applied.failedOperations.map((failure) => failure.message)
      const error = generationError('validation', 'no-applicable-changes', reasons[0] ?? 'The agent response contained no applicable changes.', reasons)
      return { ok: false, error, rawText, partialDeck }
    }
    return {
      ok: true,
      kind: 'deck',
      deck: applied.deck,
      created: applied.created,
      appliedOperations: applied.appliedOperations,
      failedOperations: applied.failedOperations,
      diagnostics: applied.diagnostics,
      message: text,
      rawText,
    }
  } catch (cause) {
    const category = abortReason ?? (cause instanceof DOMException && cause.name === 'AbortError' ? 'cancellation' : 'network')
    const error = createAppError({ category, cause }) as GenerationError
    if (category !== 'cancellation') log.error('v2 agent request failed.', { category }, error)
    return { ok: false, error, rawText, partialDeck: flushPreview() }
  } finally {
    clearTimeout(idleTimer)
    clearTimeout(totalTimer)
    input.signal?.removeEventListener('abort', abortFromParent)
    if (reader) {
      void reader.cancel().catch(() => undefined)
      try {
        reader.releaseLock()
      } catch {
        // Already released.
      }
    }
    controller.abort()
  }
}
