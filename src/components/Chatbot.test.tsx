import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { AppConfig } from '../config'
import type { GeneratePresentationInput, GeneratePresentationResult } from '../agent/agentClient'
import type { PresentationAction, ValidatedPresentationConfig } from '../domain/presentationTypes'
import { createAppError, type GenerationError } from '../lib/errors'
import type { LocalSessionMessage } from '../session/localSessionModel'
import Chatbot from './Chatbot'

const config: AppConfig = {
  apiUrl: 'https://agent.example.test/generate',
  agentModel: 'presentation-model',
  requestTimeoutMs: 1_000,
  idleTimeoutMs: 500,
  maxStreamBytes: 10_000,
}

const validPresentation = { slides: [{ title: 'Validated', content: 'Safe text' }] }
const deckState: ValidatedPresentationConfig = {
  slides: [
    { title: 'Current intro', content: 'Safe current intro' },
    { title: 'Current pricing', content: 'Safe current pricing' },
  ],
  plugins: ['highlight'],
  revealOptions: { controls: true },
}
const validActionDeck = {
  slides: [
    { title: 'Action deck', content: 'Safe action text' },
    { title: 'Second slide', content: 'More safe text' },
  ],
}

function generationError(category: GenerationError['category']): GenerationError {
  return createAppError({ category }) as GenerationError
}

function fillPrompt() {
  fireEvent.change(screen.getByTestId('prompt-input'), { target: { value: 'Make a deck' } })
}

function renderWorkspaceChatbot(overrides: Partial<React.ComponentProps<typeof Chatbot>> = {}) {
  return render(
    <Chatbot
      mode="workspace"
      sessionId="session-a"
      onGenerate={vi.fn()}
      loadConfig={() => config}
      generatePresentationClient={vi.fn().mockResolvedValue({ ok: true, presentation: validPresentation, rawText: '{}' } satisfies GeneratePresentationResult)}
      {...overrides}
    />,
  )
}

function successfulActionClient(action: PresentationAction) {
  return vi.fn(async ({ onAction }: { onAction?: (next: PresentationAction) => void }) => {
    onAction?.(action)
    return { ok: true, presentation: validActionDeck, rawText: '', actions: [action] } satisfies GeneratePresentationResult
  })
}

function createDeferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve
    reject = promiseReject
  })

  return { promise, resolve, reject }
}

describe('Chatbot', () => {
  afterEach(() => {
    cleanup()
  })

  it('calls onGenerate only after the agent client returns a validated presentation', async () => {
    const onGenerate = vi.fn()
    const generatePresentationClient = vi.fn().mockResolvedValue({
      ok: true,
      presentation: validPresentation,
      rawText: JSON.stringify(validPresentation),
    } satisfies GeneratePresentationResult)

    render(<Chatbot sessionId="session-a" onGenerate={onGenerate} loadConfig={() => config} generatePresentationClient={generatePresentationClient} />)
    fillPrompt()
    fireEvent.click(screen.getByTestId('generate-button'))

    await waitFor(() => expect(onGenerate).toHaveBeenCalledWith(
      validPresentation,
      expect.objectContaining({ sessionId: 'session-a', attemptId: expect.any(String) }),
      expect.arrayContaining([
        expect.objectContaining({ kind: 'user', text: 'Make a deck', apiRole: 'user' }),
        expect.objectContaining({ kind: 'assistant', apiRole: 'assistant' }),
      ]),
    ))
    expect(generatePresentationClient).toHaveBeenCalledWith(expect.objectContaining({ prompt: 'Make a deck', config }))
  })

  it('forwards supplied deckState to the generation client while preserving action callbacks', async () => {
    const action: PresentationAction = { action: 'edit_slide', slideIndex: 1, patch: { title: 'Updated pricing' } }
    const onPresentationAction = vi.fn().mockReturnValue({ ok: true, deck: deckState })
    const generatePresentationClient = successfulActionClient(action)

    renderWorkspaceChatbot({ deckState, onPresentationAction, generatePresentationClient })
    fillPrompt()
    fireEvent.click(screen.getByTestId('generate-button'))

    await waitFor(() => expect(generatePresentationClient).toHaveBeenCalledWith(expect.objectContaining({ deckState })))
    expect(onPresentationAction).toHaveBeenCalledWith(action, expect.objectContaining({ sessionId: 'session-a', attemptId: expect.any(String) }))
  })

  it('submits without deckState and does not fabricate non-null deck context', async () => {
    const generatePresentationClient = vi.fn().mockResolvedValue({ ok: true, presentation: validPresentation, rawText: '{}' } satisfies GeneratePresentationResult)

    render(<Chatbot sessionId="session-a" onGenerate={vi.fn()} loadConfig={() => config} generatePresentationClient={generatePresentationClient} />)
    fillPrompt()
    fireEvent.click(screen.getByTestId('generate-button'))

    await waitFor(() => expect(generatePresentationClient).toHaveBeenCalled())
    const input = generatePresentationClient.mock.calls[0]?.[0]
    expect(input).toEqual(expect.objectContaining({ prompt: 'Make a deck', config }))
    expect(input.deckState).toBeUndefined()
  })

  it('does not call onGenerate for invalid schema failures', async () => {
    const onGenerate = vi.fn()
    const generatePresentationClient = vi.fn().mockResolvedValue({ ok: false, error: generationError('validation') } satisfies GeneratePresentationResult)

    render(<Chatbot sessionId="session-a" onGenerate={onGenerate} loadConfig={() => config} generatePresentationClient={generatePresentationClient} />)
    fillPrompt()
    fireEvent.click(screen.getByTestId('generate-button'))

    expect(await screen.findByRole('alert')).toHaveTextContent('runtime validation')
    expect(onGenerate).not.toHaveBeenCalled()
  })

  it('surfaces unsafe legacy raw HTML rejection without calling onGenerate', async () => {
    const onGenerate = vi.fn()
    const generatePresentationClient = vi.fn().mockResolvedValue({ ok: false, error: generationError('unsafe-legacy-content') } satisfies GeneratePresentationResult)

    render(<Chatbot sessionId="session-a" onGenerate={onGenerate} loadConfig={() => config} generatePresentationClient={generatePresentationClient} />)
    fillPrompt()
    fireEvent.click(screen.getByTestId('generate-button'))

    expect(await screen.findByRole('alert')).toHaveTextContent('Legacy raw HTML content is not allowed')
    expect(onGenerate).not.toHaveBeenCalled()
  })

  it('cancels in-flight generation without reporting a crash', async () => {
    const onGenerate = vi.fn()
    const generatePresentationClient = vi.fn(({ signal }: { signal?: AbortSignal }) => new Promise<GeneratePresentationResult>((resolve) => {
      signal?.addEventListener('abort', () => resolve({ ok: false, error: generationError('cancellation') }), { once: true })
    }))

    render(<Chatbot sessionId="session-a" onGenerate={onGenerate} loadConfig={() => config} generatePresentationClient={generatePresentationClient} />)
    fillPrompt()
    fireEvent.click(screen.getByTestId('generate-button'))
    fireEvent.click(await screen.findByTestId('cancel-button'))

    await waitFor(() => expect(screen.queryByTestId('cancel-button')).not.toBeInTheDocument())
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(onGenerate).not.toHaveBeenCalled()
  })

  it('ignores stale progress, streamed actions, and successful completion after cancellation', async () => {
    const deferred = createDeferred<GeneratePresentationResult>()
    let capturedInput: GeneratePresentationInput | null = null
    const onGenerate = vi.fn()
    const onPresentationAction = vi.fn()
    const action: PresentationAction = { action: 'add_slide', slide: { title: 'Stale', content: 'Should not apply' } }
    const generatePresentationClient = vi.fn((input: GeneratePresentationInput) => {
      capturedInput = input
      return deferred.promise
    })

    renderWorkspaceChatbot({ onGenerate, onPresentationAction, generatePresentationClient })
    fillPrompt()
    fireEvent.click(screen.getByTestId('generate-button'))
    fireEvent.click(await screen.findByTestId('cancel-button'))

    await act(async () => {
      capturedInput?.onProgress?.('Stale progress after cancellation')
      capturedInput?.onAction?.(action)
      deferred.resolve({ ok: true, presentation: validPresentation, rawText: '{}', actions: [action] })
    })

    await waitFor(() => expect(screen.queryByTestId('cancel-button')).not.toBeInTheDocument())
    expect(screen.queryByText('Stale progress after cancellation')).not.toBeInTheDocument()
    expect(onPresentationAction).not.toHaveBeenCalled()
    expect(onGenerate).not.toHaveBeenCalled()
  })

  it('does not mutate parent state when an in-flight owner unmounts before callbacks settle', async () => {
    const deferred = createDeferred<GeneratePresentationResult>()
    let capturedInput: GeneratePresentationInput | null = null
    const onGenerate = vi.fn()
    const onPresentationAction = vi.fn()
    const generatePresentationClient = vi.fn((input: GeneratePresentationInput) => {
      capturedInput = input
      return deferred.promise
    })

    const { unmount } = renderWorkspaceChatbot({ onGenerate, onPresentationAction, generatePresentationClient })
    fillPrompt()
    fireEvent.click(screen.getByTestId('generate-button'))
    await screen.findByTestId('cancel-button')

    unmount()
    await act(async () => {
      capturedInput?.onProgress?.('Unmounted progress')
      capturedInput?.onAction?.({ action: 'add_slide', slide: { title: 'Unmounted', content: 'No parent mutation' } })
      deferred.resolve({ ok: true, presentation: validPresentation, rawText: '{}' })
    })

    expect(onPresentationAction).not.toHaveBeenCalled()
    expect(onGenerate).not.toHaveBeenCalled()
  })

  it('clears progress only for the owning successful attempt finally path', async () => {
    const deferred = createDeferred<GeneratePresentationResult>()
    const generatePresentationClient = vi.fn(({ onProgress }: GeneratePresentationInput) => {
      onProgress?.('Receiving owned stream')
      return deferred.promise
    })

    renderWorkspaceChatbot({ generatePresentationClient })
    fillPrompt()
    fireEvent.click(screen.getByTestId('generate-button'))

    expect(await screen.findByRole('status')).toHaveTextContent('Receiving owned stream')
    await act(async () => {
      deferred.resolve({ ok: true, presentation: validPresentation, rawText: '{}' })
    })
    await waitFor(() => expect(screen.queryByText('Receiving owned stream')).not.toBeInTheDocument())
    expect(screen.queryByTestId('cancel-button')).not.toBeInTheDocument()
  })

  it('shows timeout recovery guidance', async () => {
    const generatePresentationClient = vi.fn().mockResolvedValue({ ok: false, error: generationError('timeout') } satisfies GeneratePresentationResult)

    render(<Chatbot sessionId="session-a" onGenerate={vi.fn()} loadConfig={() => config} generatePresentationClient={generatePresentationClient} />)
    fillPrompt()
    fireEvent.click(screen.getByTestId('generate-button'))

    expect(await screen.findByRole('alert')).toHaveTextContent('Retry with a shorter prompt')
  })

  it('exposes stable prompt, generate, cancel, and error selectors', async () => {
    const generatePresentationClient = vi.fn(() => new Promise<GeneratePresentationResult>(() => undefined))

    render(<Chatbot sessionId="session-a" onGenerate={vi.fn()} loadConfig={() => { throw generationError('configuration') }} generatePresentationClient={generatePresentationClient} />)
    expect(screen.getByTestId('prompt-input')).toBeInTheDocument()
    expect(screen.getByTestId('generate-button')).toBeInTheDocument()

    fillPrompt()
    fireEvent.click(screen.getByTestId('generate-button'))

    expect(await screen.findByTestId('generation-error')).toBeInTheDocument()
  })

  it('renders workspace mode as a compact chat panel without the home hero/example prompt grid', () => {
    renderWorkspaceChatbot()

    expect(screen.getByTestId('prompt-input')).toBeInTheDocument()
    expect(screen.getByTestId('generate-button')).toBeInTheDocument()
    expect(screen.queryByText(/try these examples/i)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /sustainable energy/i })).not.toBeInTheDocument()
    expect(screen.getByTestId('workspace-chat-panel-form')).toHaveClass('chatbot-form--workspace')
  })

  it('renders controlled selected-session messages and sends pre-submit selected context only', async () => {
    const selectedMessages: LocalSessionMessage[] = [
      { id: 'a-user', kind: 'user', text: 'Selected session prompt', createdAt: '2026-01-01T00:00:00.000Z', apiRole: 'user' },
      { id: 'a-assistant', kind: 'assistant', text: 'Selected session answer', createdAt: '2026-01-01T00:00:01.000Z', apiRole: 'assistant' },
      { id: 'a-status', kind: 'status', text: 'Local status only', createdAt: '2026-01-01T00:00:02.000Z' },
    ]
    const onAppendSessionMessage = vi.fn()
    const onGenerate = vi.fn()
    const generatePresentationClient = vi.fn().mockResolvedValue({ ok: true, presentation: validPresentation, rawText: '{}' } satisfies GeneratePresentationResult)

    renderWorkspaceChatbot({ sessionMessages: selectedMessages, onAppendSessionMessage, onGenerate, generatePresentationClient })
    expect(screen.getByTestId('workspace-chat-history')).toHaveTextContent('Selected session prompt')
    expect(screen.getByTestId('workspace-chat-history')).toHaveTextContent('Selected session answer')

    fillPrompt()
    fireEvent.click(screen.getByTestId('generate-button'))

    await waitFor(() => expect(generatePresentationClient).toHaveBeenCalled())
    expect(generatePresentationClient).toHaveBeenCalledWith(expect.objectContaining({
      conversationContext: [
        { role: 'user', content: 'Selected session prompt' },
        { role: 'assistant', content: 'Selected session answer' },
      ],
    }))
    await waitFor(() => expect(onGenerate).toHaveBeenCalledWith(
      validPresentation,
      expect.objectContaining({ sessionId: 'session-a', attemptId: expect.any(String) }),
      expect.arrayContaining([expect.objectContaining({ kind: 'assistant', apiRole: 'assistant' })]),
    ))
    expect(onAppendSessionMessage).not.toHaveBeenCalled()
  })

  it('keeps workspace mode selectors stable through submit, cancel, and error states', async () => {
    const generatePresentationClient = vi.fn(() => new Promise<GeneratePresentationResult>(() => undefined))

    renderWorkspaceChatbot({ generatePresentationClient })
    fillPrompt()
    fireEvent.click(screen.getByTestId('generate-button'))

    expect(await screen.findByTestId('cancel-button')).toBeInTheDocument()
    expect(screen.getByTestId('prompt-input')).toBeInTheDocument()
    expect(screen.getByTestId('generate-button')).toBeInTheDocument()
  })

  it('submits workspace prompts with Enter while Shift+Enter preserves multiline editing', async () => {
    const generatePresentationClient = vi.fn().mockResolvedValue({ ok: true, presentation: validPresentation, rawText: '{}' } satisfies GeneratePresentationResult)

    renderWorkspaceChatbot({ generatePresentationClient })
    const input = screen.getByTestId('prompt-input')
    fireEvent.change(input, { target: { value: 'Make a deck' } })

    fireEvent.keyDown(input, { key: 'Enter', shiftKey: true })
    expect(generatePresentationClient).not.toHaveBeenCalled()
    fireEvent.change(input, { target: { value: 'Make a deck\nwith details' } })
    expect(input).toHaveValue('Make a deck\nwith details')

    fireEvent.keyDown(input, { key: 'Enter' })

    await waitFor(() => expect(generatePresentationClient).toHaveBeenCalledWith(expect.objectContaining({ prompt: 'Make a deck\nwith details' })))
  })

  it('hides raw stream/tool-call JSON from primary workspace chat history unless debug is explicitly enabled', async () => {
    const rawToolNoise = '{"tool_calls":[{"function":{"name":"create_deck","arguments":"{}"}}]}'
    const generatePresentationClient = vi.fn(async ({ onDelta }: { onDelta?: (delta: string) => void }) => {
      onDelta?.(rawToolNoise)
      return { ok: true, presentation: validPresentation, rawText: rawToolNoise } satisfies GeneratePresentationResult
    })

    renderWorkspaceChatbot({ generatePresentationClient })
    fillPrompt()
    fireEvent.click(screen.getByTestId('generate-button'))

    await waitFor(() => expect(generatePresentationClient).toHaveBeenCalled())
    expect(screen.getByTestId('workspace-chat-history')).not.toHaveTextContent(rawToolNoise)
    expect(screen.queryByText(rawToolNoise)).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /show json/i }))
    expect(screen.getByText(rawToolNoise)).toBeInTheDocument()
  })
  it('does not submit while an input method is composing text', async () => {
    const client = vi.fn().mockResolvedValue({ ok: true, presentation: validPresentation, rawText: '{}' })
    render(<Chatbot sessionId="session-a" onGenerate={vi.fn()} loadConfig={() => config} generatePresentationClient={client} />)
    fillPrompt()
    fireEvent.keyDown(screen.getByTestId('prompt-input'), { key: 'Enter', isComposing: true })
    expect(client).not.toHaveBeenCalled()
    fireEvent.keyDown(screen.getByTestId('prompt-input'), { key: 'Enter', isComposing: false })
    await waitFor(() => expect(client).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(screen.getByTestId('prompt-input')).toHaveValue(''))
  })

  it('rejects an oversized request before the API or persistence receives it', async () => {
    const client = vi.fn()
    render(<Chatbot sessionId="session-a" onGenerate={vi.fn()} loadConfig={() => config} generatePresentationClient={client} />)
    const input = screen.getByTestId('prompt-input')
    expect(input).toHaveAttribute('maxlength', '20000')
    fireEvent.change(input, { target: { value: 'a'.repeat(20001) } })
    fireEvent.click(screen.getByTestId('generate-button'))
    expect(await screen.findByRole('alert')).toHaveTextContent(/keep your request within/i)
    expect(client).not.toHaveBeenCalled()
  })

})
