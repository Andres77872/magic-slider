import { useEffect } from 'react'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { ApplyPresentationActionResult } from './agent/presentationActionReducer'
import type { PresentationAction, ValidatedPresentationConfig } from './domain/presentationTypes'

const validDeck: ValidatedPresentationConfig = {
  slides: [
    { title: 'Initial deck', content: 'Plain safe introduction' },
    { title: 'Second slide', content: 'Plain safe details' },
  ],
  plugins: ['highlight'],
  revealOptions: { controls: true, transition: 'slide' },
}

const editedDeck: ValidatedPresentationConfig = {
  ...validDeck,
  slides: [
    validDeck.slides[0],
    { title: 'Edited slide', content: 'Updated safe details' },
  ],
}

const brokenRevealDeck: ValidatedPresentationConfig = {
  ...validDeck,
  slides: [{ title: 'Trigger Reveal Error', content: 'Broken deck' }],
}

type ChatbotProps = {
  mode?: 'home' | 'workspace'
  sessionId: string
  deckState?: ValidatedPresentationConfig | null
  onGenerate: (config: ValidatedPresentationConfig, origin: { sessionId: string; attemptId: string }, messages: Array<{ kind: 'user' | 'assistant' | 'status' | 'tool'; text: string; apiRole?: 'user' | 'assistant' }>) => void
  onPresentationAction?: (action: PresentationAction, origin: { sessionId: string; attemptId: string }) => ApplyPresentationActionResult | void
  onGeneratingStateChange?: (generating: boolean, origin: { sessionId: string; attemptId: string }) => void
  sessionMessages?: Array<{ text: string }>
  onAppendSessionMessage?: (message: { kind: 'user' | 'assistant' | 'status' | 'tool'; text: string; apiRole?: 'user' | 'assistant' }) => void
  disabledReason?: string | null
}

let pendingMockOrigin: { sessionId: string; attemptId: string } | null = null

vi.mock('./components/RevealSlider', () => ({
  default: ({ config, onLoading, onError }: {
    config: ValidatedPresentationConfig
    onLoading?: (loading: boolean) => void
    onError?: (error: { category: 'reveal-initialization'; message: string; recovery: string }) => void
  }) => {
    useEffect(() => {
    if (config.slides.some((slide) => slide.title === 'Trigger Reveal Error')) {
      onError?.({ category: 'reveal-initialization', message: 'Reveal.js failed to initialize the deck.', recovery: 'Retry rendering or inspect Reveal lifecycle diagnostics.' })
    }
    }, [config, onError])
    return (
      <div data-testid="reveal-slider">
        <button type="button" data-testid="mock-render-start" onClick={() => onLoading?.(true)}>Start render</button>
        <button type="button" data-testid="mock-render-end" onClick={() => onLoading?.(false)}>End render</button>
        {config.slides.map((slide) => (
          <article key={slide.title}>
            <h2>{slide.title}</h2>
            <p>{slide.content}</p>
          </article>
        ))}
      </div>
    )
  },
}))

vi.mock('./components/Chatbot', () => ({
  default: ({ mode = 'home', sessionId, deckState, onGenerate, onPresentationAction, onGeneratingStateChange, sessionMessages = [], onAppendSessionMessage, disabledReason }: ChatbotProps) => (
    <section
      data-testid={mode === 'workspace' ? 'workspace-chatbot' : 'home-chatbot'}
      data-has-deck-state={deckState ? 'true' : 'false'}
      data-message-count={sessionMessages.length}
    >
      {sessionMessages.map((message, index) => <p key={`${message.text}-${index}`}>{message.text}</p>)}
      <textarea data-testid="prompt-input" aria-label="Prompt" disabled={Boolean(disabledReason)} />
      <button type="button" data-testid="submit-prompt" disabled={Boolean(disabledReason)} onClick={() => { pendingMockOrigin = { sessionId, attemptId: 'mock-attempt' }; onAppendSessionMessage?.({ kind: 'user', text: 'Mock prompt', apiRole: 'user' }); onGeneratingStateChange?.(true, pendingMockOrigin) }}>
        Submit prompt
      </button>
      <button type="button" data-testid="complete-generation" onClick={() => { const origin = pendingMockOrigin ?? { sessionId, attemptId: 'mock-attempt' }; onGeneratingStateChange?.(true, origin); pendingMockOrigin = null; onGenerate(validDeck, origin, [
        { kind: 'user', text: 'Mock prompt', apiRole: 'user' },
        { kind: 'assistant', text: 'Created presentation with 2 slides.', apiRole: 'assistant' },
      ]) }}>
        Complete generation
      </button>
      <button type="button" data-testid="complete-stale-generation" onClick={() => onGenerate(validDeck, { sessionId: 'stale-session', attemptId: 'stale-attempt' }, [
        { kind: 'user', text: 'Stale prompt', apiRole: 'user' },
        { kind: 'assistant', text: 'Stale completion should be ignored.', apiRole: 'assistant' },
      ])}>
        Complete stale generation
      </button>
      <button type="button" data-testid="complete-broken-reveal" onClick={() => { const origin = { sessionId, attemptId: 'mock-attempt' }; onGeneratingStateChange?.(true, origin); onGenerate(brokenRevealDeck, origin, [
        { kind: 'user', text: 'Mock prompt', apiRole: 'user' },
        { kind: 'assistant', text: 'Created presentation with 1 slides.', apiRole: 'assistant' },
      ]) }}>
        Complete broken Reveal generation
      </button>
      <button
        type="button"
        data-testid="create-deck-action"
        onClick={() => onPresentationAction?.({ action: 'create_deck', slides: validDeck.slides }, pendingMockOrigin ?? { sessionId, attemptId: 'mock-attempt' })}
      >
        Create deck action
      </button>
      <button
        type="button"
        data-testid="edit-slide-action"
        onClick={() => onPresentationAction?.({ action: 'edit_slide', slideIndex: 1, patch: editedDeck.slides[1] }, pendingMockOrigin ?? { sessionId, attemptId: 'mock-attempt' })}
      >
        Edit slide action
      </button>
      <button
        type="button"
        data-testid="add-slide-action"
        onClick={() => onPresentationAction?.({ action: 'add_slide', afterIndex: 1, slide: { title: 'Added slide', content: 'Added safe content' } }, pendingMockOrigin ?? { sessionId, attemptId: 'mock-attempt' })}
      >
        Add slide action
      </button>
    </section>
  ),
}))

import App from './App'

describe('App workspace flow', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    pendingMockOrigin = null
    window.localStorage.clear()
  })

  afterEach(() => {
    cleanup()
  })

  it('routes Reveal render errors into the workspace alert', async () => {
    render(<App />)

    fireEvent.click(screen.getByTestId('complete-broken-reveal'))

    expect(await screen.findByRole('alert')).toHaveTextContent(/reveal\.js failed to initialize/i)
    expect(screen.getByRole('alert')).toHaveTextContent(/retry rendering/i)
  })

  it('materializes a legacy validated generation result in the workspace with chat still visible beside the viewer', async () => {
    render(<App />)

    fireEvent.click(screen.getByTestId('complete-generation'))

    expect(await screen.findByTestId('workspace')).toHaveClass('app-workspace')
    expect(screen.getByTestId('workspace-chatbot')).toBeInTheDocument()
    const viewerPanel = screen.getByTestId('workspace-viewer-panel')
    expect(within(viewerPanel).getByTestId('reveal-slider')).toBeInTheDocument()
    expect(within(viewerPanel).getByText('Initial deck', { selector: 'h2' })).toBeInTheDocument()
  })

  it('commits the final generation after a streamed action already updated the deck', async () => {
    render(<App />)

    fireEvent.click(screen.getByTestId('submit-prompt'))
    fireEvent.click(screen.getByTestId('create-deck-action'))
    fireEvent.click(screen.getByTestId('complete-generation'))

    expect(await screen.findByTestId('workspace')).toHaveClass('app-workspace')
    expect(screen.getByTestId('workspace-viewer-panel')).toHaveTextContent('Initial deck')
    await waitFor(() => expect(window.localStorage.getItem('magic-slider:sessions:v1')).toContain('Created presentation with 2 slides.'))
  })

  it('applies follow-up edit/add actions through onPresentationAction and preserves previous deck while generating', async () => {
    render(<App />)
    fireEvent.click(screen.getByTestId('complete-generation'))
    await screen.findByText('Initial deck', { selector: 'h2' })

    fireEvent.click(screen.getByTestId('submit-prompt'))
    expect(screen.getByTestId('workspace-viewer-panel')).toHaveTextContent('Initial deck')

    fireEvent.click(screen.getByTestId('edit-slide-action'))
    expect(await within(screen.getByTestId('reveal-slider')).findByText('Edited slide')).toBeInTheDocument()

    fireEvent.click(screen.getByTestId('add-slide-action'))
    expect(await within(screen.getByTestId('reveal-slider')).findByText('Added slide')).toBeInTheDocument()
  })

  it('preserves the previous valid deck when follow-up generation fails or validation rejects an action', async () => {
    render(<App />)
    fireEvent.click(screen.getByTestId('complete-generation'))
    await screen.findByText('Initial deck', { selector: 'h2' })

    fireEvent.click(screen.getByTestId('submit-prompt'))
    fireEvent.click(screen.getByTestId('create-deck-action'))

    await waitFor(() => expect(screen.getByTestId('workspace-viewer-panel')).toHaveTextContent('Initial deck'))
    expect(screen.getByTestId('workspace-viewer-panel')).not.toHaveTextContent(/invalid|partial/i)
  })

  it('ignores app-level generation completions and streamed actions from stale origins', async () => {
    render(<App />)
    fireEvent.click(screen.getByTestId('complete-stale-generation'))

    expect(screen.queryByTestId('workspace')).not.toBeInTheDocument()
    expect(screen.queryByText('Initial deck')).not.toBeInTheDocument()

    fireEvent.click(screen.getByTestId('submit-prompt'))
    fireEvent.click(screen.getByTestId('create-deck-action'))

    expect(await screen.findByTestId('home-chatbot')).toBeInTheDocument()
    expect(screen.queryByText('Initial deck')).not.toBeInTheDocument()
  })

  it('resets to a fresh home session when New Presentation is clicked', async () => {
    render(<App />)
    fireEvent.click(screen.getByTestId('complete-generation'))
    await screen.findByText('Initial deck', { selector: 'h2' })

    fireEvent.click(screen.getByRole('button', { name: /new presentation/i }))

    expect(await screen.findByTestId('home-chatbot')).toBeInTheDocument()
    expect(screen.queryByTestId('workspace')).not.toBeInTheDocument()
    expect(screen.queryByText('Initial deck')).not.toBeInTheDocument()
  })

  it('creates distinct local sessions and switches through Recent Sessions without overwriting decks', async () => {
    render(<App />)
    fireEvent.click(screen.getByTestId('submit-prompt'))
    fireEvent.click(screen.getByTestId('complete-generation'))
    await screen.findByText('Initial deck', { selector: 'h2' })

    fireEvent.click(screen.getByRole('button', { name: /new presentation/i }))
    expect(await screen.findByTestId('home-chatbot')).toHaveAttribute('data-message-count', '0')
    expect(screen.getByRole('button', { name: /mock prompt/i })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /mock prompt/i }))

    expect(await screen.findByText('Initial deck', { selector: 'h2' })).toBeInTheDocument()
    expect(screen.getByTestId('workspace-chatbot')).toHaveAttribute('data-message-count', '3')
    expect(screen.getByTestId('workspace-viewer-panel')).toHaveTextContent('Initial deck')
  })

  it('blocks active-generation session switches with visible coordination instead of changing sessions', async () => {
    render(<App />)
    fireEvent.click(screen.getByTestId('submit-prompt'))
    fireEvent.click(screen.getByTestId('complete-generation'))
    await screen.findByText('Initial deck', { selector: 'h2' })

    fireEvent.click(screen.getByRole('button', { name: /new presentation/i }))
    await screen.findByTestId('home-chatbot')
    const previousSessionButton = screen.getByRole('button', { name: /mock prompt/i })
    expect(previousSessionButton).toBeEnabled()

    fireEvent.click(screen.getByTestId('submit-prompt'))

    expect(previousSessionButton).toBeDisabled()
    expect(screen.getByTestId('home-chatbot')).toBeInTheDocument()
  })

  it('routes corrupt persistence recovery to visible home controls and blocks prompt input until handled', async () => {
    window.localStorage.setItem('magic-slider:sessions:v1', '{nope')

    render(<App />)

    expect(await screen.findByRole('alert')).toHaveTextContent(/local history needs recovery/i)
    expect(screen.getByTestId('prompt-input')).toBeDisabled()
    expect(screen.getByTestId('submit-prompt')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /continue fresh/i }))

    await waitFor(() => expect(screen.getByTestId('prompt-input')).toBeEnabled())
    expect(screen.getByRole('alert')).toHaveTextContent(/continuing with a fresh local history/i)
  })

  it('undoes and redoes generated deck versions', async () => {
    render(<App />)
    fireEvent.click(screen.getByTestId('complete-generation'))
    await screen.findByText('Initial deck', { selector: 'h2' })
    const undo = screen.getByRole('button', { name: /undo last change/i })
    const redo = screen.getByRole('button', { name: /redo change/i })
    expect(undo).toBeDisabled()
    expect(redo).toBeDisabled()

    fireEvent.click(screen.getByTestId('complete-broken-reveal'))
    await within(screen.getByTestId('reveal-slider')).findByText('Trigger Reveal Error')
    expect(undo).toBeEnabled()

    fireEvent.click(undo)
    expect(within(screen.getByTestId('reveal-slider')).getByText('Initial deck')).toBeInTheDocument()
    const saved = JSON.parse(window.localStorage.getItem('magic-slider:sessions:v1') ?? '{}')
    expect(saved.sessions.find((session: { id: string }) => session.id === saved.selectedSessionId).currentDeckSnapshot).toEqual(validDeck)
    expect(screen.getByText('Restored the previous version of the deck.')).toBeInTheDocument()
    expect(undo).toBeDisabled()
    expect(redo).toBeEnabled()

    fireEvent.click(redo)
    expect(within(screen.getByTestId('reveal-slider')).getByText('Trigger Reveal Error')).toBeInTheDocument()
    expect(redo).toBeDisabled()
  })

  it('clears local history and leaves Recent Sessions empty', async () => {
    render(<App />)
    fireEvent.click(screen.getByTestId('submit-prompt'))
    fireEvent.click(screen.getByTestId('complete-generation'))
    await screen.findByText('Initial deck', { selector: 'h2' })

    fireEvent.click(screen.getByTestId('clear-history-button'))
    fireEvent.click(screen.getByTestId('confirm-clear-history'))

    expect(await screen.findByText(/no recent sessions/i)).toBeInTheDocument()
    expect(window.localStorage.getItem('magic-slider:sessions:v1')).toBeNull()
  })
  it('keeps the current presentation visible if clearing saved history fails', async () => {
    render(<App />)
    fireEvent.click(screen.getByTestId('complete-generation'))
    await screen.findByTestId('reveal-slider')
    const saved = window.localStorage.getItem('magic-slider:sessions:v1')
    const remove = vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => { throw new Error('Storage unavailable') })
    fireEvent.click(screen.getByTestId('clear-history-button'))
    fireEvent.click(screen.getByTestId('confirm-clear-history'))
    expect(screen.getByTestId('reveal-slider')).toHaveTextContent('Initial deck')
    expect(window.localStorage.getItem('magic-slider:sessions:v1')).toBe(saved)
    expect(screen.getByRole('alert')).toHaveTextContent(/local history needs recovery/i)
    remove.mockRestore()
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    await waitFor(() => expect(screen.queryByTestId('workspace')).not.toBeInTheDocument())
    expect(window.localStorage.getItem('magic-slider:sessions:v1')).toBeNull()
  })

})
