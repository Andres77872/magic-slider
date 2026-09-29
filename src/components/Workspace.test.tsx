import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { ApplyPresentationActionResult } from '../agent/presentationActionReducer'
import { generatePresentation } from '../agent/agentClient'
import type { GeneratePresentationResult } from '../agent/agentClient'
import type { PresentationAction, ValidatedPresentationConfig } from '../domain/presentationTypes'

vi.mock('../agent/agentClient', () => ({
  generatePresentation: vi.fn(),
}))

type WorkspaceComponent = React.ComponentType<{
  config: ValidatedPresentationConfig | null
  isGenerating: boolean
  isSwitchingSession?: boolean
  error?: string | null
  onGenerate: (config: ValidatedPresentationConfig, origin: { sessionId: string; attemptId: string }) => void
  onPresentationAction: (action: PresentationAction, origin: { sessionId: string; attemptId: string }) => ApplyPresentationActionResult | void
  onGeneratingStateChange: (generating: boolean, origin: { sessionId: string; attemptId: string }) => void
  onReset: () => void
  onRevealError?: (error: { category: string; message: string; recovery: string }) => void
  sessionSummaries?: Array<{ id: string; title: string; createdAt: string; updatedAt: string; messageCount: number; slideCount: number }>
  selectedSessionId?: string
  selectedSessionTitle?: string
  onSelectSession?: (sessionId: string) => void
  onClearHistory?: () => void
  onRetryPersistence?: () => void
  onContinueFresh?: () => void
  persistenceStatus?: 'idle' | 'hydrating' | 'ready' | 'recovered' | 'failed'
  persistenceError?: string | null
  canMutateLocalHistory?: boolean
}>

const validDeck: ValidatedPresentationConfig = {
  slides: [
    { title: 'Workspace intro', content: 'Plain safe introduction' },
    { title: 'Workspace plan', content: 'Plain safe plan' },
  ],
  plugins: ['highlight'],
  revealOptions: { controls: true, transition: 'slide' },
}

const restoreProperties: Array<() => void> = []

function setBrowserProperty(target: object, key: PropertyKey, descriptor: PropertyDescriptor) {
  const original = Object.getOwnPropertyDescriptor(target, key)
  Object.defineProperty(target, key, { configurable: true, ...descriptor })
  restoreProperties.push(() => {
    if (original) Object.defineProperty(target, key, original)
    else Reflect.deleteProperty(target, key)
  })
}

function enableFullscreen() {
  let fullscreenElement: Element | null = null
  const request = vi.fn<() => Promise<void>>().mockResolvedValue(undefined)
  const exit = vi.fn<() => Promise<void>>().mockResolvedValue(undefined)
  setBrowserProperty(document, 'fullscreenEnabled', { value: true })
  setBrowserProperty(document, 'fullscreenElement', { get: () => fullscreenElement })
  setBrowserProperty(document, 'exitFullscreen', { value: exit })
  setBrowserProperty(HTMLElement.prototype, 'requestFullscreen', { value: request })

  return {
    request,
    exit,
    change(element: Element | null) {
      fullscreenElement = element
      fireEvent(document, new Event('fullscreenchange'))
    },
  }
}

function readBlob(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error)
    reader.readAsText(blob)
  })
}

async function loadWorkspace(): Promise<WorkspaceComponent> {
  return (await import('./Workspace')).default as WorkspaceComponent
}

async function renderWorkspace(overrides: Partial<React.ComponentProps<WorkspaceComponent>> = {}) {
  const Workspace = await loadWorkspace()
  const props: React.ComponentProps<WorkspaceComponent> = {
    config: validDeck,
    isGenerating: false,
    error: null,
    onGenerate: vi.fn(),
    onPresentationAction: vi.fn(),
    onGeneratingStateChange: vi.fn(),
    onReset: vi.fn(),
    ...overrides,
  }

  return { props, ...render(<Workspace {...props} />) }
}

describe('Workspace', () => {
  beforeEach(() => {
    vi.stubEnv('VITE_API_URL', 'https://agent.example.test/v1/chat/completions')
    vi.stubEnv('VITE_AGENT_MODEL', 'test-agent')
  })

  afterEach(() => {
    cleanup()
    vi.useRealTimers()
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
    while (restoreProperties.length > 0) restoreProperties.pop()?.()
    vi.clearAllMocks()
  })

  it('passes current config into the workspace chatbot as deckState on submit', async () => {
    vi.mocked(generatePresentation).mockResolvedValue({ ok: true, presentation: validDeck, rawText: '{}' } satisfies GeneratePresentationResult)
    await renderWorkspace({ config: validDeck })

    fireEvent.change(screen.getByTestId('prompt-input'), { target: { value: 'Edit the pricing slide' } })
    fireEvent.click(screen.getByTestId('generate-button'))

    await waitFor(() => expect(generatePresentation).toHaveBeenCalledWith(expect.objectContaining({ deckState: validDeck })))
  })

  it('uses the latest config as deckState after rerendering with an updated deck', async () => {
    vi.mocked(generatePresentation).mockResolvedValue({ ok: true, presentation: validDeck, rawText: '{}' } satisfies GeneratePresentationResult)
    const updatedDeck: ValidatedPresentationConfig = {
      ...validDeck,
      slides: [...validDeck.slides, { title: 'Updated close', content: 'Plain safe close' }],
    }
    const Workspace = await loadWorkspace()
    const props: React.ComponentProps<WorkspaceComponent> = {
      config: validDeck,
      isGenerating: false,
      error: null,
      onGenerate: vi.fn(),
      onPresentationAction: vi.fn(),
      onGeneratingStateChange: vi.fn(),
      onReset: vi.fn(),
    }
    const { rerender } = render(<Workspace {...props} />)

    rerender(<Workspace {...props} config={updatedDeck} />)
    fireEvent.change(screen.getByTestId('prompt-input'), { target: { value: 'Edit the closing slide' } })
    fireEvent.click(screen.getByTestId('generate-button'))

    await waitFor(() => expect(generatePresentation).toHaveBeenCalledWith(expect.objectContaining({ deckState: updatedDeck })))
    expect(generatePresentation).not.toHaveBeenCalledWith(expect.objectContaining({ deckState: validDeck }))
  })

  it('renders the chat and viewer panels in the workspace shell without editor-only surfaces', async () => {
    await renderWorkspace()

    const workspace = screen.getByTestId('workspace')
    expect(workspace).toHaveClass('app-workspace')
    expect(screen.getByTestId('workspace-chat-panel')).toBeInTheDocument()
    expect(screen.getByTestId('workspace-viewer-panel')).toBeInTheDocument()
    expect(within(screen.getByTestId('reveal-slider')).getByText('Workspace intro')).toBeInTheDocument()

    const navigator = screen.getByTestId('slide-navigator')
    expect(within(navigator).getAllByRole('button').map((button) => button.getAttribute('aria-label'))).toEqual(
      validDeck.slides.map((slide, index) => expect.stringContaining(`Slide ${index + 1}: ${slide.title}`)),
    )
    expect(within(navigator).getAllByRole('button')[0]).toHaveAttribute('aria-current', 'true')
    expect(screen.queryByTestId('slide-editor')).not.toBeInTheDocument()
  })

  it('renders the deck-ready state with the existing Reveal viewer path', async () => {
    await renderWorkspace()

    const viewerPanel = screen.getByTestId('workspace-viewer-panel')
    expect(within(viewerPanel).getByTestId('reveal-slider')).toBeInTheDocument()
    expect(within(screen.getByTestId('reveal-slider')).getByText('Workspace plan')).toBeInTheDocument()
  })

  it('shows validation or generation errors with retry guidance without replacing a valid deck', async () => {
    await renderWorkspace({ error: 'Validation failed. Retry with safer slide content.' })

    const viewerPanel = screen.getByTestId('workspace-viewer-panel')
    expect(within(viewerPanel).getByRole('alert')).toHaveTextContent(/validation failed/i)
    expect(within(viewerPanel).getByText(/retry/i)).toBeInTheDocument()
    expect(within(screen.getByTestId('reveal-slider')).getByText('Workspace intro')).toBeInTheDocument()
  })

  it('collapses and expands chat without discarding the rendered viewer', async () => {
    await renderWorkspace()
    const slider = screen.getByTestId('reveal-slider')
    const prompt = screen.getByTestId('prompt-input')
    const chatBody = document.getElementById('workspace-chat-body')
    fireEvent.change(prompt, { target: { value: 'Keep my unfinished draft' } })

    fireEvent.click(screen.getByRole('button', { name: /collapse chat/i }))

    expect(screen.getByTestId('workspace')).toHaveClass('app-workspace--chat-collapsed')
    expect(screen.getByTestId('workspace-chat-panel')).toHaveClass('workspace-chat-panel--collapsed')
    expect(within(slider).getByText('Workspace intro')).toBeInTheDocument()
    expect(chatBody).toHaveAttribute('hidden')
    expect(chatBody).toHaveAttribute('inert')
    expect(prompt).not.toBeVisible()
    expect(screen.getByRole('button', { name: /expand chat/i })).toHaveAttribute('aria-expanded', 'false')

    fireEvent.click(screen.getByRole('button', { name: /expand chat/i }))

    expect(screen.getByTestId('workspace')).not.toHaveClass('app-workspace--chat-collapsed')
    expect(screen.getByTestId('workspace-chat-panel')).not.toHaveClass('workspace-chat-panel--collapsed')
    expect(screen.getByTestId('reveal-slider')).toBe(slider)
    expect(within(slider).getByText('Workspace intro')).toBeInTheDocument()
    expect(chatBody).not.toHaveAttribute('hidden')
    expect(chatBody).not.toHaveAttribute('inert')
    expect(prompt).toBeVisible()
    expect(prompt).toHaveValue('Keep my unfinished draft')
  })

  it('exports the current deck as JSON and releases its download URL', async () => {
    const objectUrl = 'blob:magic-slider-export'
    const createObjectURL = vi.fn<(blob: Blob) => string>().mockReturnValue(objectUrl)
    const revokeObjectURL = vi.fn()
    setBrowserProperty(URL, 'createObjectURL', { value: createObjectURL })
    setBrowserProperty(URL, 'revokeObjectURL', { value: revokeObjectURL })
    let download: { href: string; filename: string } | undefined
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      download = { href: this.href, filename: this.download }
    })
    const exportedDeck = { ...validDeck, slides: [{ title: 'Launch / Plan: Q4 🚀', content: 'Preserve line one\nAnd line two' }] }
    await renderWorkspace({ config: exportedDeck })
    const exportButton = screen.getByRole('button', { name: /export json/i })
    await waitFor(() => expect(exportButton).toBeEnabled())

    vi.useFakeTimers()
    fireEvent.click(exportButton)

    expect(createObjectURL).toHaveBeenCalledTimes(1)
    expect(download).toEqual({ href: objectUrl, filename: 'Launch-Plan-Q4.json' })
    expect(revokeObjectURL).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1000)
    expect(revokeObjectURL).toHaveBeenCalledWith(objectUrl)
    vi.useRealTimers()
    const blob = createObjectURL.mock.calls[0][0]
    expect(blob.type).toBe('application/json')
    expect(JSON.parse(await readBlob(blob))).toEqual(exportedDeck)
  })

  it('exports a standalone HTML deck with speaker notes', async () => {
    const createObjectURL = vi.fn<(blob: Blob) => string>().mockReturnValue('blob:html-export')
    setBrowserProperty(URL, 'createObjectURL', { value: createObjectURL })
    setBrowserProperty(URL, 'revokeObjectURL', { value: vi.fn() })
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined)
    await renderWorkspace({ config: { slides: [{ title: 'Ready to share', notes: 'Private presenter note' }] } })
    const button = screen.getByRole('button', { name: /export html/i })
    await waitFor(() => expect(button).toBeEnabled())
    fireEvent.click(button)
    await waitFor(() => expect(click).toHaveBeenCalledTimes(1))
    const blob = createObjectURL.mock.calls[0][0]
    expect(blob.type).toBe('text/html;charset=utf-8')
    const html = await readBlob(blob)
    const doc = new DOMParser().parseFromString(html, 'text/html')
    expect(doc.title).toBe('Ready to share')
    expect(doc.querySelector('aside.notes')?.textContent).toBe('Private presenter note')
    expect((click.mock.contexts[0] as HTMLAnchorElement).download).toBe('Ready-to-share.html')
    expect(document.querySelector('a[download]')).toBeNull()
  })

  it('surfaces export failures and leaves the deck available for retry', async () => {
    setBrowserProperty(URL, 'createObjectURL', { value: vi.fn(() => { throw new Error('Download denied') }) })
    await renderWorkspace()
    const button = screen.getByRole('button', { name: /export html/i })
    await waitFor(() => expect(button).toBeEnabled())
    fireEvent.click(button)
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/could not be exported/i))
    expect(screen.getByRole('button', { name: /export html/i })).toBeEnabled()
    expect(screen.getByTestId('reveal-slider')).toBeInTheDocument()
  })

  it('shows the deck title and count and disables toolbar actions while updating', async () => {
    enableFullscreen()
    const { props, rerender } = await renderWorkspace()
    const Workspace = await loadWorkspace()
    const viewer = screen.getByTestId('workspace-viewer-panel')
    expect(within(viewer).getByRole('heading', { level: 1, name: 'Workspace intro' })).toBeInTheDocument()
    expect(within(viewer).getByText(/live preview.*2 slides/i)).toBeInTheDocument()
    await waitFor(() => expect(screen.getByRole('button', { name: /export json/i })).toBeEnabled())

    rerender(<Workspace {...props} isGenerating />)

    expect(screen.getByRole('button', { name: /export json/i })).toBeDisabled()
    expect(screen.getByRole('button', { name: /export html/i })).toBeDisabled()
    expect(screen.getByRole('button', { name: /^present/i })).toBeDisabled()
    rerender(<Workspace {...props} config={null} />)
    expect(screen.getByRole('button', { name: /export json/i })).toBeDisabled()
    expect(screen.getByRole('button', { name: /export html/i })).toBeDisabled()
    expect(screen.getByRole('button', { name: /^present/i })).toBeDisabled()
  })

  it('hides Present when the browser does not support fullscreen', async () => {
    setBrowserProperty(document, 'fullscreenEnabled', { value: false })
    await renderWorkspace()

    expect(screen.queryByRole('button', { name: /^present/i })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /export json/i })).toBeInTheDocument()
  })

  it('requests fullscreen for the preview and follows browser entry and exit events', async () => {
    const fullscreen = enableFullscreen()
    await renderWorkspace()
    const presentButton = screen.getByRole('button', { name: /^present/i })
    // Presenting shows only the slides, not the editing toolbar or navigator.
    const viewer = screen.getByTestId('presentation-stage')
    await waitFor(() => expect(presentButton).toBeEnabled())

    fireEvent.click(presentButton)
    await waitFor(() => expect(fullscreen.request).toHaveBeenCalledTimes(1))
    expect(fullscreen.request.mock.contexts[0]).toBe(viewer)
    expect(screen.queryByRole('button', { name: /exit fullscreen/i })).not.toBeInTheDocument()
    fullscreen.change(viewer)
    fireEvent.click(screen.getByRole('button', { name: /exit fullscreen/i }))
    await waitFor(() => expect(fullscreen.exit).toHaveBeenCalledTimes(1))
    fullscreen.change(null)
    expect(screen.getByRole('button', { name: /^present/i })).toBeInTheDocument()
  })

  it('reports a denied fullscreen request and lets the viewer retry', async () => {
    const fullscreen = enableFullscreen()
    fullscreen.request.mockRejectedValueOnce(new DOMException('Permission denied', 'NotAllowedError'))
    await renderWorkspace()
    const presentButton = screen.getByRole('button', { name: /^present/i })
    await waitFor(() => expect(presentButton).toBeEnabled())

    fireEvent.click(presentButton)
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/fullscreen is unavailable/i))
    expect(screen.getByTestId('reveal-slider')).toBeInTheDocument()
    fireEvent.click(presentButton)
    await waitFor(() => expect(fullscreen.request).toHaveBeenCalledTimes(2))
    expect(screen.queryByText(/fullscreen is unavailable/i)).not.toBeInTheDocument()
  })

  it('invokes reset from the New Presentation workspace action', async () => {
    const onReset = vi.fn()
    await renderWorkspace({ onReset })

    fireEvent.click(screen.getByRole('button', { name: /new presentation/i }))

    expect(onReset).toHaveBeenCalledTimes(1)
  })

  it('renders Recent Sessions, switches selected sessions, and exposes Clear History', async () => {
    const onSelectSession = vi.fn()
    const onClearHistory = vi.fn()
    await renderWorkspace({
      selectedSessionId: 'session-b',
      selectedSessionTitle: 'Session B',
      sessionSummaries: [
        { id: 'session-b', title: 'Session B', createdAt: '2026-01-02T00:00:00.000Z', updatedAt: '2026-01-02T00:00:00.000Z', messageCount: 2, slideCount: 3 },
        { id: 'session-a', title: 'Session A', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', messageCount: 1, slideCount: 1 },
      ],
      onSelectSession,
      onClearHistory,
      persistenceStatus: 'ready',
    })

    expect(screen.getByTestId('recent-sessions')).toHaveTextContent('Session A')
    fireEvent.click(screen.getByRole('button', { name: /session a/i }))
    expect(onSelectSession).toHaveBeenCalledWith('session-a')

    fireEvent.click(screen.getByTestId('clear-history-button'))
    fireEvent.click(screen.getByTestId('confirm-clear-history'))
    expect(onClearHistory).toHaveBeenCalledTimes(1)
    expect(screen.getByText(/saved locally in this browser only/i)).toBeInTheDocument()
  })

  it('communicates when no recent sessions are available', async () => {
    await renderWorkspace({ sessionSummaries: [] })

    expect(screen.getByTestId('recent-sessions')).toHaveTextContent(/no recent sessions/i)
  })

  it('shows failed persistence recovery controls and disables history-sensitive actions', async () => {
    const onRetryPersistence = vi.fn()
    const onContinueFresh = vi.fn()
    const onClearHistory = vi.fn()
    await renderWorkspace({
      config: null,
      persistenceStatus: 'failed',
      persistenceError: 'Stored local history is corrupt.',
      canMutateLocalHistory: false,
      onRetryPersistence,
      onContinueFresh,
      onClearHistory,
      sessionSummaries: [{ id: 'session-a', title: 'Session A', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', messageCount: 1, slideCount: 0 }],
    })

    expect(screen.getAllByRole('alert').some((alert) => /local history needs recovery/i.test(alert.textContent ?? ''))).toBe(true)
    expect(screen.getByRole('button', { name: /new presentation/i })).toBeDisabled()
    expect(screen.getByRole('button', { name: /session a/i })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: /retry/i }))
    fireEvent.click(screen.getByRole('button', { name: /continue fresh/i }))
    const clearButtons = screen.getAllByRole('button', { name: /clear history/i })
    fireEvent.click(clearButtons[clearButtons.length - 1])
    expect(onRetryPersistence).toHaveBeenCalledTimes(1)
    expect(onContinueFresh).toHaveBeenCalledTimes(1)
    expect(onClearHistory).toHaveBeenCalledTimes(1)
  })

  it('distinguishes loading empty viewer state from normal idle empty state', async () => {
    const { rerender, props } = await renderWorkspace({ config: null, isGenerating: false })
    const Workspace = await loadWorkspace()

    expect(screen.getByTestId('workspace-viewer-panel')).toHaveTextContent(/presentation will appear here/i)
    expect(screen.queryByLabelText(/presentation preview loading skeleton/i)).not.toBeInTheDocument()

    rerender(<Workspace {...props} config={null} isGenerating />)

    expect(screen.getByLabelText(/presentation preview loading skeleton/i)).toBeInTheDocument()
    expect(screen.getByTestId('workspace-viewer-panel')).toHaveAttribute('aria-busy', 'true')
  })

  it('exposes responsive workspace layout classes without relying on browser measurements', async () => {
    await renderWorkspace()

    expect(screen.getByTestId('workspace')).toHaveClass('app-workspace', 'app-workspace--responsive')
    expect(screen.getByTestId('workspace-chat-panel')).toHaveClass('workspace-chat-panel')
    expect(screen.getByTestId('workspace-viewer-panel')).toHaveClass('workspace-viewer-panel')
    expect(screen.getByTestId('workspace-mobile-chat-toggle')).toHaveClass('workspace-mobile-chat-toggle')
  })

  it('keeps testable responsive and collapsed modifiers on the workspace root', async () => {
    await renderWorkspace()

    fireEvent.click(screen.getByRole('button', { name: /collapse chat/i }))

    expect(screen.getByTestId('workspace')).toHaveClass('app-workspace--chat-collapsed')
    expect(screen.getByTestId('workspace')).toHaveClass('app-workspace--responsive')
    expect(screen.getByTestId('workspace-viewer-panel')).toHaveClass('workspace-viewer-panel--expanded')
  })
})
