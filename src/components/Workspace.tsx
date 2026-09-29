import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react'

import type { ApplyPresentationActionResult } from '../agent/presentationActionReducer'
import Chatbot, { type CommittedGenerationMessage, type GenerationOrigin } from './Chatbot'
import RevealSlider from './RevealSlider'
import PersistenceNotice from './PersistenceNotice'
import SessionList from './SessionList'
import SlideNavigator from './SlideNavigator'
import SlideNotesPanel from './SlideNotesPanel'
import { downloadPresentation, presentationFileName } from '../presentation/downloadPresentation'
import { deckTitle } from '../domain/presentationSchema'
import type { PresentationAction, ValidatedPresentationConfig } from '../domain/presentationTypes'
import type { RenderError } from '../lib/errors'
import type { RevealDeckLike } from '../presentation/useRevealDeck'
import type { LocalSessionMessage, LocalSessionSummary } from '../session/localSessionModel'
import type { PersistenceFailureKind, PersistenceStatus } from '../session/useLocalSessions'

interface WorkspaceProps {
  config: ValidatedPresentationConfig | null
  isGenerating: boolean
  isSwitchingSession?: boolean
  error?: string | null
  onGenerate: (config: ValidatedPresentationConfig, origin: GenerationOrigin, committedMessages: CommittedGenerationMessage[]) => void
  onConversation?: (origin: GenerationOrigin, messages: CommittedGenerationMessage[]) => void
  onPresentationAction: (action: PresentationAction, origin: GenerationOrigin) => ApplyPresentationActionResult | void
  onGeneratingStateChange: (generating: boolean, origin: GenerationOrigin) => void
  onReset: () => void
  onRevealError?: (error: RenderError) => void
  sessionMessages?: LocalSessionMessage[]
  sessionSummaries?: LocalSessionSummary[]
  selectedSessionId?: string
  selectedSessionTitle?: string
  onSelectSession?: (sessionId: string) => void
  onClearHistory?: () => void
  onRetryPersistence?: () => void
  onContinueFresh?: () => void
  persistenceStatus?: PersistenceStatus
  persistenceFailureKind?: PersistenceFailureKind | null
  persistenceError?: string | null
  canMutateLocalHistory?: boolean
  onAppendSessionMessage?: (message: Omit<LocalSessionMessage, 'id' | 'createdAt'>, options?: { flush?: boolean }) => void
  canUndo?: boolean
  canRedo?: boolean
  onUndo?: () => void
  onRedo?: () => void
}

type ToolbarNotice = { kind: 'error' | 'success'; text: string }

const REVEAL_ALL_FRAGMENTS = 1_000

function describeExport(fileName: string, embedded: number, linked: number): string {
  const parts = [`Downloaded ${fileName}.`]
  if (embedded) parts.push(`${embedded} image${embedded === 1 ? ' is' : 's are'} embedded, so it works offline.`)
  if (linked) parts.push(`${linked} image${linked === 1 ? ' stays' : 's stay'} linked and need${linked === 1 ? 's' : ''} an internet connection.`)
  return parts.join(' ')
}

const Workspace = (_props: WorkspaceProps) => {
  const {
    config,
    isGenerating,
    isSwitchingSession = false,
    error,
    onGenerate,
    onConversation,
    onPresentationAction,
    onGeneratingStateChange,
    onReset,
    onRevealError,
    sessionMessages,
    sessionSummaries = [],
    selectedSessionId,
    selectedSessionTitle,
    onSelectSession,
    onClearHistory,
    onRetryPersistence,
    onContinueFresh,
    persistenceStatus,
    persistenceFailureKind,
    persistenceError,
    canMutateLocalHistory = true,
    onAppendSessionMessage,
    canUndo = false,
    canRedo = false,
    onUndo,
    onRedo,
  } = _props
  const [isChatCollapsed, setIsChatCollapsed] = useState(() => window.matchMedia?.('(max-width: 768px)').matches ?? false)
  const [isDeckRendering, setIsDeckRendering] = useState(false)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [isExporting, setIsExporting] = useState(false)
  const [toolbarNotice, setToolbarNotice] = useState<ToolbarNotice | null>(null)
  const [showNotes, setShowNotes] = useState(false)
  const [currentSlide, setCurrentSlide] = useState(0)
  const stageRef = useRef<HTMLDivElement>(null)
  const deckRef = useRef<RevealDeckLike | null>(null)

  const slideCount = config?.slides.length ?? 0
  const activeSlide = Math.min(currentSlide, Math.max(0, slideCount - 1))

  useEffect(() => {
    const onFullscreenChange = () => setIsFullscreen(document.fullscreenElement === stageRef.current)
    document.addEventListener('fullscreenchange', onFullscreenChange)
    return () => document.removeEventListener('fullscreenchange', onFullscreenChange)
  }, [])

  useEffect(() => {
    if (toolbarNotice?.kind !== 'success') return undefined
    const timer = window.setTimeout(() => setToolbarNotice(null), 8000)
    return () => window.clearTimeout(timer)
  }, [toolbarNotice])

  const handleDeckReady = useCallback((deck: RevealDeckLike) => {
    deckRef.current = deck
    const index = deck.getIndices?.().h
    if (typeof index === 'number') setCurrentSlide(index)
  }, [])

  const handleSlideChange = useCallback((event: unknown) => {
    const index = (event as { indexh?: unknown } | null)?.indexh
    if (typeof index === 'number') setCurrentSlide(index)
  }, [])

  const goToSlide = (index: number) => {
    setCurrentSlide(index)
    try {
      // Jumping from the navigator is for reviewing, so show every fragment.
      deckRef.current?.slide?.(index, 0, REVEAL_ALL_FRAGMENTS)
    } catch {
      // The preview may be re-initializing; the navigator keeps the intent.
    }
  }

  const present = async () => {
    setToolbarNotice(null)
    try {
      if (document.fullscreenElement === stageRef.current) {
        await document.exitFullscreen()
      } else {
        await stageRef.current?.requestFullscreen()
        stageRef.current?.focus()
      }
    } catch {
      setToolbarNotice({ kind: 'error', text: 'Fullscreen is unavailable. You can still navigate the slides in the preview.' })
    }
  }

  // Keeps arrow keys working after focus lands on the stage rather than inside Reveal.
  const handleStageKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const deck = deckRef.current
    if (!deck || deck.isFocused?.() || event.target !== event.currentTarget) return
    if (['ArrowRight', 'ArrowDown', 'PageDown', ' '].includes(event.key)) {
      event.preventDefault()
      deck.next?.()
    } else if (['ArrowLeft', 'ArrowUp', 'PageUp'].includes(event.key)) {
      event.preventDefault()
      deck.prev?.()
    }
  }

  const exportDeck = () => {
    if (!config) return
    setToolbarNotice(null)
    try {
      downloadPresentation(JSON.stringify(config, null, 2), config, 'json')
      setToolbarNotice({ kind: 'success', text: `Downloaded ${presentationFileName(config, 'json')}. It can be re-imported or versioned.` })
    } catch {
      setToolbarNotice({ kind: 'error', text: 'The deck could not be downloaded. Please try again.' })
    }
  }

  const exportHtml = async () => {
    if (!config || isExporting) return
    setToolbarNotice(null)
    setIsExporting(true)
    try {
      const { exportPresentationWithAssets } = await import('../presentation/exportPresentation')
      const result = await exportPresentationWithAssets(config)
      downloadPresentation(result.html, config, 'html')
      setToolbarNotice({ kind: 'success', text: describeExport(presentationFileName(config, 'html'), result.embeddedImages, result.linkedImages) })
    } catch {
      setToolbarNotice({ kind: 'error', text: 'The presentation could not be exported. Please try again or export JSON to save your work.' })
    } finally {
      setIsExporting(false)
    }
  }

  const isPersistenceHydrating = persistenceStatus === 'hydrating'
  const persistenceInteractionBlockReason = !canMutateLocalHistory
    ? (persistenceStatus === 'hydrating'
      ? 'Local presentation history is still loading. Generation and session changes are disabled until recovery finishes.'
      : 'Local presentation history needs recovery. Retry, continue fresh, or clear history before generating or changing sessions.')
    : null
  const isViewerBusy = isGenerating || isSwitchingSession || isDeckRendering || isPersistenceHydrating
  const historyBusy = isGenerating || isSwitchingSession || isPersistenceHydrating || !canMutateLocalHistory
  const workspaceClassName = [
    'app-workspace',
    'app-workspace--responsive',
    isChatCollapsed ? 'app-workspace--chat-collapsed' : null,
  ].filter(Boolean).join(' ')

  const chatPanelClassName = [
    'workspace-chat-panel',
    isChatCollapsed ? 'workspace-chat-panel--collapsed' : null,
  ].filter(Boolean).join(' ')

  const viewerPanelClassName = [
    'workspace-viewer-panel',
    isChatCollapsed ? 'workspace-viewer-panel--expanded' : null,
  ].filter(Boolean).join(' ')

  const title = config ? deckTitle(config) : selectedSessionTitle || 'Your presentation'

  return (
    <div className={workspaceClassName} data-testid="workspace">
      <aside className={chatPanelClassName} data-testid="workspace-chat-panel" aria-label="Presentation chat">
        <header className="workspace-chat-header">
          <div className="workspace-chat-header__brand">
            <h2 className="brand"><span className="brand-mark" aria-hidden="true">M</span><span className="brand-name">Magic Slider</span></h2>
            <p className="workspace-eyebrow">Presentation studio</p>
          </div>
          <div className="workspace-chat-actions">
            <button
              type="button"
              className="btn btn-ghost workspace-chat-collapse"
              onClick={() => setIsChatCollapsed((collapsed) => !collapsed)}
              aria-expanded={!isChatCollapsed}
              aria-controls="workspace-chat-body"
              title={isChatCollapsed ? 'Expand chat' : 'Collapse chat'}
            >
              <span aria-hidden="true">{isChatCollapsed ? '»' : '«'}</span>
              <span className="workspace-chat-collapse__label">{isChatCollapsed ? 'Expand chat' : 'Collapse chat'}</span>
            </button>
            <button type="button" className="btn btn-secondary" onClick={onReset} disabled={!canMutateLocalHistory || isSwitchingSession || isGenerating}>
              <span aria-hidden="true">＋</span> New Presentation
            </button>
          </div>
        </header>

        <section className="workspace-session-panel" aria-label="Recent Sessions">
          <SessionList
            variant="workspace"
            sessions={sessionSummaries}
            selectedSessionId={selectedSessionId}
            disabled={isSwitchingSession || isGenerating || !canMutateLocalHistory}
            clearDisabled={isSwitchingSession || isGenerating || persistenceStatus === 'hydrating'}
            onSelect={onSelectSession}
            onClear={onClearHistory}
          />
          {persistenceStatus === 'ready' && !persistenceError && (
            <p className="workspace-session-copy">Saved locally in this browser only.</p>
          )}
        </section>

        <button
          type="button"
          className="workspace-mobile-chat-toggle"
          data-testid="workspace-mobile-chat-toggle"
          onClick={() => setIsChatCollapsed((collapsed) => !collapsed)}
          aria-expanded={!isChatCollapsed}
          aria-controls="workspace-chat-body"
        >
          {isChatCollapsed ? 'Open chat' : 'Chat panel'}
        </button>

        <div id="workspace-chat-body" className="workspace-chat-body" hidden={isChatCollapsed} inert={isChatCollapsed}>
          <Chatbot
            key={selectedSessionId}
            mode="workspace"
            sessionId={selectedSessionId ?? 'unknown-session'}
            deckState={config}
            onGenerate={onGenerate}
            onConversation={onConversation}
            onPresentationAction={onPresentationAction}
            onGeneratingStateChange={onGeneratingStateChange}
            sessionMessages={sessionMessages}
            onAppendSessionMessage={onAppendSessionMessage}
            disabledReason={persistenceInteractionBlockReason}
          />
        </div>
      </aside>

      <main
        className={viewerPanelClassName}
        data-testid="workspace-viewer-panel"
        aria-label="Presentation preview"
        aria-busy={isViewerBusy ? 'true' : undefined}
      >
        <header className="viewer-toolbar">
          <div className="viewer-toolbar__title">
            <p className="workspace-eyebrow">
              LIVE PREVIEW{config ? ` / ${config.slides.length} SLIDES` : ''}
              {config && <span className="viewer-toolbar__theme"> · {config.theme ?? 'midnight'} theme</span>}
            </p>
            <h1>{title}</h1>
          </div>
          <div className="viewer-toolbar__actions" role="toolbar" aria-label="Presentation actions">
            <div className="button-group" role="group" aria-label="History">
              <button type="button" className="btn btn-ghost btn-icon-only" onClick={onUndo} disabled={!canUndo || historyBusy} aria-label="Undo last change" title="Undo last change">
                <span aria-hidden="true">↶</span>
              </button>
              <button type="button" className="btn btn-ghost btn-icon-only" onClick={onRedo} disabled={!canRedo || historyBusy} aria-label="Redo change" title="Redo change">
                <span aria-hidden="true">↷</span>
              </button>
            </div>
            <button type="button" className="btn btn-ghost" aria-pressed={showNotes} disabled={!config} onClick={() => setShowNotes((open) => !open)}>
              Notes
            </button>
            <button type="button" className="btn btn-secondary" disabled={!config || isViewerBusy || isExporting} onClick={exportDeck}>Export JSON</button>
            <button type="button" className="btn btn-secondary" disabled={!config || isViewerBusy || isExporting} onClick={() => void exportHtml()}>{isExporting ? 'Exporting…' : 'Export HTML'}</button>
            {document.fullscreenEnabled && (
              <button type="button" className="btn btn-primary" disabled={!config || isViewerBusy} onClick={() => void present()}>
                {isFullscreen ? 'Exit fullscreen' : 'Present'}<span aria-hidden="true"> ▶</span>
              </button>
            )}
          </div>
        </header>
        {toolbarNotice && (
          <p className={`workspace-status workspace-status--${toolbarNotice.kind === 'error' ? 'error' : 'success'}`} role={toolbarNotice.kind === 'error' ? 'alert' : 'status'}>
            {toolbarNotice.text}
          </p>
        )}
        <section className="workspace-viewer-status" aria-live="polite">
          {isGenerating && (
            <p className="workspace-status workspace-status-generating" role="status">
              Updating your presentation… You can cancel from the chat.
            </p>
          )}
          {isSwitchingSession && (
            <p className="workspace-status workspace-status-generating" role="status">
              Switching presentation… Preparing the selected deck.
            </p>
          )}
          {isPersistenceHydrating && (
            <p className="workspace-status workspace-status-generating" role="status">
              Loading local presentation history…
            </p>
          )}
          <PersistenceNotice
            status={persistenceStatus}
            error={persistenceError}
            failureKind={persistenceFailureKind}
            busy={isGenerating || isSwitchingSession}
            onRetry={onRetryPersistence}
            onContinueFresh={onContinueFresh}
            onClear={onClearHistory}
          />
          {isDeckRendering && config && (
            <p className="workspace-status workspace-status-generating" role="status">
              Rendering presentation… Preparing slides.
            </p>
          )}
          {error && (
            <div className="workspace-status workspace-status-error" role="alert">
              {error} Retry by editing your prompt and generating again.
            </div>
          )}
        </section>

        {config ? (
          <>
            <div
              ref={stageRef}
              className="viewer-stage"
              data-testid="presentation-stage"
              tabIndex={-1}
              onKeyDown={handleStageKeyDown}
            >
              <RevealSlider
                key={selectedSessionId}
                config={config}
                onLoading={setIsDeckRendering}
                onError={onRevealError}
                onReady={handleDeckReady}
                onSlideChange={handleSlideChange}
              />
            </div>
            <SlideNavigator deck={config} currentIndex={activeSlide} disabled={isSwitchingSession} onSelect={goToSlide} />
            {showNotes && <SlideNotesPanel slide={config.slides[activeSlide]} slideNumber={activeSlide + 1} />}
          </>
        ) : (
          <div className={`workspace-viewer-empty${isGenerating || isPersistenceHydrating ? ' workspace-viewer-empty--loading' : ''}`}>
            <h2>Presentation will appear here</h2>
            {isGenerating || isPersistenceHydrating ? (
              <div className="workspace-viewer-skeleton" aria-label="Presentation preview loading skeleton">
                <p role="status">
                  {isPersistenceHydrating ? 'Loading local presentation history before the viewer becomes interactive…' : 'Researching, designing and writing… Waiting for a validated deck.'}
                </p>
                <div className="skeleton skeleton--text skeleton--text-wide" />
                <div className="skeleton skeleton--card" />
                <div className="skeleton skeleton--block" />
                <div className="skeleton skeleton--text" />
              </div>
            ) : (
              <p>
                Describe your idea in the chat to create your first slides.
              </p>
            )}
          </div>
        )}
      </main>
    </div>
  )
}

export default Workspace
