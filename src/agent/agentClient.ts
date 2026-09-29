import type { AppConfig } from '../config'
import { parsePresentationToolCalls, type PresentationAction } from '../domain/presentationActions'
import { extractPresentationJson } from './jsonExtractor'
import { parseSseChunk, type OpenAiToolCallDelta, type SseParseState } from './streamParser'
import { validatePresentation } from '../domain/presentationSchema'
import { createAppError, type GenerationError } from '../lib/errors'
import { logger as defaultLogger, type Logger } from '../lib/logger'
import type { ValidatedPresentationConfig } from '../domain/presentationTypes'
import { formatDeckContext } from './deckContextFormatter'
import { AGENT_CONTEXT_MESSAGE_LIMIT, LOCAL_SESSION_MESSAGE_MAX_LENGTH } from '../session/localSessionModel'
import { applyPresentationAction } from './presentationActionReducer'

export type AgentConversationMessage = { role: 'user' | 'assistant'; content: string }

export type GeneratePresentationResult =
  | { ok: true; kind?: 'presentation'; presentation: ValidatedPresentationConfig; rawText: string; actions?: PresentationAction[]; message?: string }
  | { ok: true; kind: 'message'; message: string; rawText: string }
  | { ok: false; error: GenerationError; rawText?: string }

export interface GeneratePresentationInput {
  prompt: string
  config: AppConfig
  deckState?: ValidatedPresentationConfig | null
  conversationContext?: AgentConversationMessage[]
  signal?: AbortSignal
  onDelta?: (delta: string) => void
  onProgress?: (message: string) => void
  onAction?: (action: PresentationAction) => void
  /** Clock used for the client context message; injectable for tests. */
  now?: () => Date
}

export interface AgentClientDeps {
  fetch?: typeof fetch
  logger?: Logger
}

function toGenerationError(error: ReturnType<typeof createAppError>): GenerationError {
  return error as GenerationError
}

function mapHttpStatus(status: number, bodyText: string): GenerationError {
  const category = status === 401 || status === 403 ? 'auth' : status === 429 ? 'rate-limit' : 'http'
  return toGenerationError(createAppError({
    category,
    diagnostics: [{ code: 'http-status', message: `Agent endpoint returned HTTP ${status}.`, details: { status, bodyText } }],
  }))
}

type PendingToolCall = {
  index: number
  id?: string
  type: 'function'
  function: {
    name?: string
    arguments: string
  }
  execution?: OpenAiToolCallDelta['execution']
  source?: OpenAiToolCallDelta['source']
}

function mergeToolCallDelta(pending: Map<number, PendingToolCall>, delta: OpenAiToolCallDelta): void {
  const existing = pending.get(delta.index)
  const next: PendingToolCall = {
    index: delta.index,
    id: delta.id ?? existing?.id,
    type: 'function',
    function: {
      name: delta.function.name === undefined ? existing?.function.name : `${existing?.function.name ?? ''}${delta.function.name}`,
      arguments: `${existing?.function.arguments ?? ''}${delta.function.arguments ?? ''}`,
    },
    execution: delta.execution ?? existing?.execution,
    source: delta.source ?? existing?.source,
  }
  pending.set(delta.index, next)
}

function toolCallValidationError(cause: unknown): GenerationError {
  return toGenerationError(createAppError({
    category: 'validation',
    diagnostics: [{ code: 'presentation-action', message: 'Presentation tool action failed validation.', details: cause }],
    cause,
  }))
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError'
}

function abortError(): DOMException {
  return new DOMException('The operation was aborted.', 'AbortError')
}

function raceWithAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(abortError())

  return new Promise((resolve, reject) => {
    const onAbort = () => reject(abortError())
    signal.addEventListener('abort', onAbort, { once: true })
    promise.then(
      (value) => {
        signal.removeEventListener('abort', onAbort)
        resolve(value)
      },
      (error: unknown) => {
        signal.removeEventListener('abort', onAbort)
        reject(error)
      },
    )
  })
}

/** Models do not know today's date; research for "latest" or "current" topics depends on it. */
export function clientContext(now: Date = new Date()): string {
  const date = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone
  return `Client context: today is ${date}${zone ? ` (${zone})` : ''}. Interpret "latest", "current" and relative dates from this date.`
}

function buildAgentMessages(input: GeneratePresentationInput): Array<{ role: 'system' | 'user' | 'assistant'; content: string }> {
  const userMessage = { role: 'user' as const, content: input.prompt }
  const boundedContext = (input.conversationContext ?? [])
    .filter((message) => (message.role === 'user' || message.role === 'assistant') && message.content.trim() && message.content !== input.prompt)
    .slice(-AGENT_CONTEXT_MESSAGE_LIMIT)

  const deckContext = input.deckState ? formatDeckContext(input.deckState) : null
  const system = [deckContext, clientContext(input.now?.() ?? new Date())].filter(Boolean).join('\n\n')
  return [{ role: 'system', content: system }, ...boundedContext, userMessage]
}

function plainAssistantMessage(rawText: string): string | undefined {
  const text = rawText.trim()
  // The public adapter owns visibility: only final assistant content reaches
  // this channel. Keep JSON/fenced deck output out of conversation history.
  if (!text || /^[{["`]/.test(text) || /```|"(?:slides|tool_calls|function|slideIndex)"\s*:/.test(text)) return undefined
  try {
    JSON.parse(text)
    return undefined
  } catch {
    const suffix = '… [response shortened]'
    return text.length <= LOCAL_SESSION_MESSAGE_MAX_LENGTH
      ? text
      : text.slice(0, LOCAL_SESSION_MESSAGE_MAX_LENGTH - suffix.length) + suffix
  }
}

export async function generatePresentation(
  input: GeneratePresentationInput,
  deps: AgentClientDeps = {},
): Promise<GeneratePresentationResult> {
  const fetchImpl = deps.fetch ?? fetch
  const log = deps.logger ?? defaultLogger
  const controller = new AbortController()
  let abortReason: 'cancellation' | 'timeout' | undefined
  let rawText = ''
  let bytesRead = 0
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined
  let receivingProgressReported = false
  const pendingToolCalls = new Map<number, PendingToolCall>()

  const abortFromParent = () => {
    if (controller.signal.aborted) return
    abortReason = 'cancellation'
    controller.abort()
  }

  if (input.signal?.aborted) abortFromParent()
  input.signal?.addEventListener('abort', abortFromParent, { once: true })

  const abortForTimeout = () => {
    if (controller.signal.aborted) return
    abortReason = 'timeout'
    controller.abort()
  }

  let idleTimer = window.setTimeout(abortForTimeout, input.config.idleTimeoutMs)
  const totalTimer = window.setTimeout(abortForTimeout, input.config.requestTimeoutMs)

  const resetIdleTimer = () => {
    window.clearTimeout(idleTimer)
    idleTimer = window.setTimeout(abortForTimeout, input.config.idleTimeoutMs)
  }

  const reportProgress = (message: string) => {
    if (controller.signal.aborted) throw abortError()
    input.onProgress?.(message)
    if (controller.signal.aborted) throw abortError()
  }

  try {
    if (controller.signal.aborted) throw abortError()
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (input.config.apiKey) headers.Authorization = `Bearer ${input.config.apiKey}`

    reportProgress('Sending your request…')
    const response = await raceWithAbort(fetchImpl(input.config.apiUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: input.config.agentModel,
        messages: buildAgentMessages(input),
        stream: true,
      }),
      signal: controller.signal,
    }), controller.signal)
    resetIdleTimer()

    if (!response.ok) {
      // Error responses share the request's time and size bounds. Providers can
      // return an unbounded or stalled body even after sending HTTP headers.
      reader = response.body?.getReader()
      const decoder = new TextDecoder()
      const diagnosticLimit = Math.min(input.config.maxStreamBytes, 4_096)
      let bodyText = ''
      while (reader && bytesRead < diagnosticLimit) {
        const { done, value } = await raceWithAbort(reader.read(), controller.signal)
        if (done) break
        resetIdleTimer()
        const bounded = value.subarray(0, diagnosticLimit - bytesRead)
        bytesRead += bounded.byteLength
        bodyText += decoder.decode(bounded, { stream: true })
      }
      bodyText += decoder.decode()
      const error = mapHttpStatus(response.status, bodyText)
      log.error('Agent endpoint returned an unsuccessful response.', { status: response.status }, error)
      return { ok: false, error }
    }

    if (!response.body) {
      const error = toGenerationError(createAppError({
        category: 'stream-corruption',
        diagnostics: [{ code: 'missing-body', message: 'Successful agent response did not include a readable body.' }],
      }))
      log.error('Agent response body missing.', undefined, error)
      return { ok: false, error }
    }

    reader = response.body.getReader()
    const decoder = new TextDecoder()
    let state: SseParseState = { buffer: '', done: false }

    while (!state.done) {
      const { done, value } = await raceWithAbort(reader.read(), controller.signal)
      if (done) break
      resetIdleTimer()

      bytesRead += value.byteLength
      if (bytesRead > input.config.maxStreamBytes) {
        controller.abort()
        const error = toGenerationError(createAppError({ category: 'size-limit' }))
        log.error('Agent response exceeded max stream bytes.', { maxStreamBytes: input.config.maxStreamBytes }, error)
        return { ok: false, error, rawText }
      }

      const chunk = decoder.decode(value, { stream: true })
      const parsed = parseSseChunk(state, chunk)
      state = parsed.state

      for (const event of parsed.events) {
        if (controller.signal.aborted) throw abortError()
        if (!receivingProgressReported && (event.type === 'delta' || event.type === 'tool_call')) {
          receivingProgressReported = true
          reportProgress(event.type === 'tool_call' ? 'Receiving slide changes…' : 'Receiving presentation content…')
        }
        if (event.type === 'delta') {
          rawText += event.content
          input.onDelta?.(event.content)
          continue
        }

        if (event.type === 'tool_call') {
          for (const toolCall of event.toolCalls) mergeToolCallDelta(pendingToolCalls, toolCall)
          continue
        }

        if (event.type === 'stream_error') {
          const error = toGenerationError(createAppError({
            category: 'stream-corruption',
            diagnostics: [{ code: `stream-${event.finishReason}`, message: 'The agent did not complete the generation.', details: event.raw }],
          }))
          log.error('Agent stream did not complete successfully.', { finishReason: event.finishReason }, error)
          return { ok: false, error, rawText }
        }

        if (event.type === 'diagnostic') {
          const error = toGenerationError(createAppError({
            category: 'stream-corruption',
            diagnostics: [{ code: event.reason, message: 'Malformed streamed agent event.', details: event.raw }],
          }))
          log.error('Malformed streamed agent event.', { reason: event.reason }, error)
          return { ok: false, error, rawText }
        }
      }
    }

    if (controller.signal.aborted) throw abortError()
    if (!state.done) {
      const error = toGenerationError(createAppError({
        category: 'stream-corruption',
        diagnostics: [{ code: 'missing-completion-marker', message: 'Agent stream ended before its [DONE] completion marker.' }],
      }))
      log.error('Agent stream ended before completion.', undefined, error)
      return { ok: false, error, rawText }
    }

    reportProgress('Validating your presentation…')
    if (pendingToolCalls.size > 0) {
      try {
        const actions = [...pendingToolCalls.values()]
          .sort((left, right) => left.index - right.index)
          .flatMap((toolCall) => parsePresentationToolCalls(toolCall))

        let presentation = input.deckState ?? null
        for (const action of actions) {
          const applied = applyPresentationAction(presentation, action)
          if (!applied.ok) {
            log.error('Presentation action could not be applied.', { action: action.action }, applied.error)
            return { ok: false, error: applied.error, rawText }
          }
          presentation = applied.deck
        }

        if (!presentation) throw new Error('Presentation actions did not produce a complete deck.')

        // Validate the whole transaction before notifying consumers so a later
        // invalid action cannot leave the workspace with a partially applied deck.
        for (const action of actions) {
          if (controller.signal.aborted) throw abortError()
          input.onAction?.(action)
        }
        if (controller.signal.aborted) throw abortError()
        return { ok: true, presentation, rawText, actions, message: plainAssistantMessage(rawText) }
      } catch (cause) {
        if (controller.signal.aborted) throw cause
        const error = toolCallValidationError(cause)
        log.error('Presentation tool action validation failed.', undefined, error)
        return { ok: false, error, rawText }
      }
    }

    const message = plainAssistantMessage(rawText)
    if (message) return { ok: true, kind: 'message', message, rawText }

    const extracted = extractPresentationJson(rawText, { maxBytes: input.config.maxStreamBytes })
    if (!extracted.ok) {
      log.error('Agent JSON extraction failed.', undefined, extracted.error)
      return { ok: false, error: extracted.error, rawText }
    }

    const validated = validatePresentation(extracted.data)
    if (!validated.ok) {
      log.error('Agent presentation validation failed.', undefined, validated.error)
      return { ok: false, error: validated.error, rawText }
    }

    return { ok: true, presentation: validated.data, rawText }
  } catch (cause) {
    const category = abortReason ?? (isAbortError(cause) ? 'cancellation' : 'network')
    const error = toGenerationError(createAppError({ category, cause }))
    if (category !== 'cancellation') log.error('Agent generation request failed.', { category }, error)
    return { ok: false, error, rawText }
  } finally {
    window.clearTimeout(idleTimer)
    window.clearTimeout(totalTimer)
    input.signal?.removeEventListener('abort', abortFromParent)
    if (reader) {
      // Do not await cancel: a custom transport's cancellation can itself stall.
      void reader.cancel().catch(() => undefined)
      reader.releaseLock()
    }
    controller.abort()
  }
}
