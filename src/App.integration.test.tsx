import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { PresentationAction, ValidatedPresentationConfig } from './domain/presentationTypes'
import { LOCAL_SESSION_STORAGE_KEY, getSelectedSession, localSessionEnvelopeSchema } from './session/localSessionModel'

// Keep the application, form, API client, reducers, and persistence real. Reveal's
// layout engine is the sole component boundary outside this integration test.
vi.mock('./components/RevealSlider', () => ({
  default: ({ config }: { config: ValidatedPresentationConfig }) => (
    <section data-testid="rendered-deck">
      {config.slides.map((slide, index) => (
        <article key={index}>
          <h2>{slide.title}</h2>
          <p>{slide.content}</p>
        </article>
      ))}
    </section>
  ),
}))

import App from './App'

const initialDeck: ValidatedPresentationConfig = {
  slides: [
    { title: 'Launch plan', content: 'A safe introduction' },
    { title: 'Audience', content: 'The original audience' },
  ],
  plugins: ['highlight'],
}

const createAction: PresentationAction = { action: 'create_deck', ...initialDeck }
const firstPatch = { title: 'Focused audience', content: 'Independent design teams' }
const firstEdit: PresentationAction = { action: 'edit_slide', slideIndex: 1, patch: firstPatch }
const firstResult: ValidatedPresentationConfig = {
  ...initialDeck,
  slides: [initialDeck.slides[0], { ...initialDeck.slides[1], ...firstPatch }],
}

function toolEvent(actions: PresentationAction[]): string {
  const toolCalls = actions.map(({ action, ...args }, index) => ({
    index,
    id: `call-${index}`,
    type: 'function',
    function: { name: action, arguments: JSON.stringify(args) },
    execution: 'client',
    source: 'schema_only',
  }))
  return `data: ${JSON.stringify({ choices: [{ index: 0, delta: { tool_calls: toolCalls }, finish_reason: null }] })}\n\n`
}

function controlledResponse(actions: PresentationAction[]) {
  let controller!: ReadableStreamDefaultController<Uint8Array>
  const cancel = vi.fn()
  const body = new ReadableStream<Uint8Array>({
    start(streamController) {
      controller = streamController
      controller.enqueue(new TextEncoder().encode(toolEvent(actions)))
    },
    cancel,
  })
  return {
    body,
    cancel,
    response: new Response(body, { headers: { 'Content-Type': 'text/event-stream' } }),
    complete() {
      controller.enqueue(new TextEncoder().encode('data: [DONE]\n\n'))
      controller.close()
    },
    truncate() { controller.close() },
  }
}

function completedResponse(actions: PresentationAction[]) {
  const stream = controlledResponse(actions)
  stream.complete()
  return stream.response
}

function persistedSession() {
  const saved = window.localStorage.getItem(LOCAL_SESSION_STORAGE_KEY)
  if (!saved) throw new Error('Expected a persisted presentation session.')
  return getSelectedSession(localSessionEnvelopeSchema.parse(JSON.parse(saved)))
}

function submitPrompt(prompt: string) {
  fireEvent.change(screen.getByTestId('prompt-input'), { target: { value: prompt } })
  fireEvent.click(screen.getByTestId('generate-button'))
}

describe('App generation and persistence integration', () => {
  const fetchMock = vi.fn<typeof fetch>()

  beforeEach(() => {
    fetchMock.mockReset()
    window.localStorage.clear()
    vi.stubGlobal('fetch', fetchMock)
    vi.stubEnv('VITE_API_URL', 'https://agent.example.test/v1/chat/completions')
    vi.stubEnv('VITE_AGENT_MODEL', 'agt-integration-test')
    vi.stubEnv('VITE_AGENT_API_KEY', '')
    vi.stubEnv('VITE_AGENT_REQUEST_TIMEOUT_MS', '5000')
    vi.stubEnv('VITE_AGENT_IDLE_TIMEOUT_MS', '5000')
    vi.stubEnv('VITE_AGENT_MAX_STREAM_BYTES', '100000')
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
  })

  it('persists a home clarification and supplies it as context without creating a deck', async () => {
    const question = 'Who is the audience for this presentation?'
    const body = new ReadableStream<Uint8Array>({ start(controller) {
      controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({ choices: [{ delta: { content: question } }] })}\n\ndata: [DONE]\n\n`))
      controller.close()
    } })
    fetchMock.mockResolvedValueOnce(new Response(body))
    render(<App />)
    submitPrompt('Help me prepare a presentation')

    await waitFor(() => expect(screen.getByTestId('workspace-chat-history')).toHaveTextContent(question))
    expect(screen.queryByTestId('workspace')).not.toBeInTheDocument()
    expect(screen.queryByTestId('generation-error')).not.toBeInTheDocument()
    expect(persistedSession().currentDeckSnapshot).toBeNull()
    expect(persistedSession().messages.map(({ text }) => text)).toEqual(['Help me prepare a presentation', question])

    fetchMock.mockResolvedValueOnce(completedResponse([createAction]))
    submitPrompt('Independent design teams')
    await screen.findByTestId('workspace')
    const request = JSON.parse(String(fetchMock.mock.calls[1][1]?.body))
    expect(request.messages).toEqual([
      { role: 'system', content: expect.stringMatching(/^Client context: today is /) },
      { role: 'user', content: 'Help me prepare a presentation' },
      { role: 'assistant', content: question },
      { role: 'user', content: 'Independent design teams' },
    ])
  })

  it('shows and persists image failure disclosure while applying a successful deck', async () => {
    const warning = 'Image generation failed; this deck uses a plain background.'
    const text = `data: ${JSON.stringify({ choices: [{ delta: { content: warning } }] })}\n\n${toolEvent([createAction])}data: [DONE]\n\n`
    fetchMock.mockResolvedValueOnce(new Response(new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode(text)); controller.close() } })))
    render(<App />)
    submitPrompt('Create slides with an original image')

    await screen.findByTestId('workspace')
    expect(screen.getByTestId('workspace-chat-history')).toHaveTextContent(warning)
    expect(persistedSession().currentDeckSnapshot).toEqual(initialDeck)
    expect(persistedSession().messages.slice(-1)[0]?.text).toBe(warning)
  })

  it('keeps an existing deck unchanged when the agent asks which slide to edit', async () => {
    fetchMock.mockResolvedValueOnce(completedResponse([createAction]))
    render(<App />)
    submitPrompt('Create a deck')
    await screen.findByTestId('workspace')
    const question = 'Which slide should I remove?'
    const text = `data: ${JSON.stringify({ choices: [{ delta: { content: question } }] })}\n\ndata: [DONE]\n\n`
    fetchMock.mockResolvedValueOnce(new Response(new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode(text)); controller.close() } })))
    submitPrompt('Remove that slide')

    await waitFor(() => expect(screen.getByTestId('workspace-chat-history')).toHaveTextContent(question))
    expect(persistedSession().currentDeckSnapshot).toEqual(initialDeck)
    expect(persistedSession().messages.slice(-1)[0]?.text).toBe(question)
    expect(screen.getByTestId('prompt-input')).not.toBeDisabled()
    expect(screen.queryByTestId('generation-error')).not.toBeInTheDocument()
  })

  it('commits sequential create/edit tools, completes a later edit-only prompt, and restores the same session on reload', async () => {
    const firstStream = controlledResponse([createAction, firstEdit])
    fetchMock.mockResolvedValueOnce(firstStream.response)
    const mounted = render(<App />)

    submitPrompt('Create a launch plan for designers')

    await waitFor(() => expect(firstStream.body.locked).toBe(true))
    expect(await screen.findByText('Receiving slide changes…')).toBeVisible()
    expect(screen.getByTestId('cancel-button')).toBeInTheDocument()
    expect(screen.queryByTestId('workspace')).not.toBeInTheDocument()
    expect(window.localStorage.getItem(LOCAL_SESSION_STORAGE_KEY)).toBeNull()
    expect(fetchMock.mock.calls[0]?.[1]?.signal?.aborted).toBe(false)

    await act(async () => { firstStream.complete() })

    const preview = await screen.findByTestId('rendered-deck')
    expect(within(preview).getAllByRole('heading').map((heading) => heading.textContent)).toEqual(['Launch plan', 'Focused audience'])
    expect(preview).toHaveTextContent('Independent design teams')
    await waitFor(() => expect(screen.getByTestId('workspace-viewer-panel')).not.toHaveAttribute('aria-busy'))

    const firstSession = persistedSession()
    expect(firstSession.currentDeckSnapshot).toEqual(firstResult)
    expect(firstSession.actionLog.map((entry) => entry.action)).toEqual([createAction, firstEdit])
    expect(firstSession.actionLog.every((entry) => entry.result === 'applied')).toBe(true)
    expect(firstSession.messages.filter((message) => message.apiRole).map(({ kind, text }) => ({ kind, text }))).toEqual([
      { kind: 'user', text: 'Create a launch plan for designers' },
      { kind: 'assistant', text: 'Created presentation with 2 slides.' },
    ])
    expect(firstSession.messages).toEqual(expect.arrayContaining([expect.objectContaining({ kind: 'status', text: 'Updated slide 2.' })]))
    expect(screen.getByTestId('prompt-input')).toHaveValue('')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()

    const followup: PresentationAction = { action: 'edit_slide', slideIndex: 0, patch: { title: 'Ready to launch', content: 'A sharper opening' } }
    const updatedDeck = { ...firstResult, slides: [{ ...firstResult.slides[0], ...followup.patch }, firstResult.slides[1]] }
    fetchMock.mockResolvedValueOnce(completedResponse([followup]))

    submitPrompt('Make the opening sharper')

    await waitFor(() => expect(screen.getByTestId('rendered-deck')).toHaveTextContent('Ready to launch'))
    await waitFor(() => expect(screen.getByTestId('prompt-input')).toHaveValue(''))
    expect(screen.getByTestId('workspace-chat-history')).toHaveTextContent('Updated presentation with 2 slides.')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()

    const secondSession = persistedSession()
    expect(secondSession.id).toBe(firstSession.id)
    expect(secondSession.currentDeckSnapshot).toEqual(updatedDeck)
    expect(secondSession.actionLog.map((entry) => entry.action)).toEqual([createAction, firstEdit, followup])
    expect(secondSession.messages.filter((message) => message.apiRole).map(({ kind, text }) => ({ kind, text }))).toEqual([
      { kind: 'user', text: 'Create a launch plan for designers' },
      { kind: 'assistant', text: 'Created presentation with 2 slides.' },
      { kind: 'user', text: 'Make the opening sharper' },
      { kind: 'assistant', text: 'Updated presentation with 2 slides.' },
    ])

    const secondRequest = JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body))
    expect(secondRequest).toMatchObject({ model: 'agt-integration-test', stream: true })
    expect(secondRequest.messages).toEqual([
      { role: 'system', content: expect.stringContaining('Focused audience') },
      { role: 'user', content: 'Create a launch plan for designers' },
      { role: 'assistant', content: 'Created presentation with 2 slides.' },
      { role: 'user', content: 'Make the opening sharper' },
    ])

    mounted.unmount()
    render(<App />)

    expect(await screen.findByTestId('rendered-deck')).toHaveTextContent('Ready to launch')
    expect(screen.getByTestId('workspace-chat-history')).toHaveTextContent('Make the opening sharper')
    expect(persistedSession()).toEqual(secondSession)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it.each(['cancelled', 'truncated'] as const)('preserves the prior deck and saved conversation when a follow-up stream is %s', async (ending) => {
    fetchMock.mockResolvedValueOnce(completedResponse([createAction]))
    render(<App />)
    submitPrompt('Create the original deck')
    await screen.findByTestId('rendered-deck')
    const before = persistedSession()
    const rejectedEdit: PresentationAction = { action: 'edit_slide', slideIndex: 1, patch: { title: 'Must not be committed' } }
    const stream = controlledResponse([rejectedEdit])
    fetchMock.mockResolvedValueOnce(stream.response)

    submitPrompt(`An edit that will be ${ending}`)

    await waitFor(() => expect(stream.body.locked).toBe(true))
    expect(await screen.findByText('Receiving slide changes…')).toBeVisible()
    expect(screen.getByTestId('workspace-viewer-panel')).toHaveAttribute('aria-busy', 'true')
    expect(screen.getByTestId('rendered-deck')).toHaveTextContent('Audience')
    expect(persistedSession()).toEqual(before)

    if (ending === 'cancelled') {
      fireEvent.click(screen.getByTestId('cancel-button'))
      await waitFor(() => expect(stream.cancel).toHaveBeenCalledTimes(1))
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    } else {
      const errorLog = vi.spyOn(console, 'error').mockImplementation(() => undefined)
      await act(async () => { stream.truncate() })
      expect(await screen.findByTestId('generation-error')).toHaveTextContent('The streamed agent response was malformed.')
      expect(errorLog).toHaveBeenCalledWith('Agent stream ended before completion.', expect.objectContaining({ category: 'stream-corruption' }))
    }

    await waitFor(() => expect(screen.queryByTestId('cancel-button')).not.toBeInTheDocument())
    expect(screen.queryByText('Receiving slide changes…')).not.toBeInTheDocument()
    expect(screen.getByTestId('workspace-viewer-panel')).not.toHaveAttribute('aria-busy')
    expect(screen.getByTestId('rendered-deck')).not.toHaveTextContent('Must not be committed')
    expect(screen.getByTestId('prompt-input')).toHaveValue(`An edit that will be ${ending}`)
    expect(stream.body.locked).toBe(false)
    expect(persistedSession()).toEqual(before)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})
