import React, { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react'
import { applyPresentationAction, type ApplyPresentationActionResult } from './agent/presentationActionReducer'
import Chatbot, { type CommittedGenerationMessage, type GenerationOrigin } from './components/Chatbot'
import PersistenceNotice from './components/PersistenceNotice'
import SessionList from './components/SessionList'
import { describePresentationAction } from './lib/presentationCopy'
import { stripBriefPreferences } from './lib/briefPreferences'
import type { PresentationAction, ValidatedPresentationConfig } from './domain/presentationTypes'
import { createAppError, getUserErrorMessage, type GenerationError, type RenderError } from './lib/errors'
import { useLocalSessions } from './session/useLocalSessions'

const Workspace = lazy(() => import('./components/Workspace'))

type AppView = 'home' | 'workspace'
type DeckHistory = { undo: ValidatedPresentationConfig[]; redo: ValidatedPresentationConfig[] }

const DECK_HISTORY_LIMIT = 30

const features = [
  { title: 'Researched', text: 'Live web research with cited sources for facts and figures.' },
  { title: 'Illustrated', text: 'Original images in one consistent art direction.' },
  { title: 'Designed', text: 'Ten slide layouts and six themes, chosen for your story.' },
  { title: 'Portable', text: 'Present fullscreen or export a self-contained HTML deck.' },
]

const App: React.FC = () => {
  const localSessions = useLocalSessions()
  const [view, setView] = useState<AppView>('home')
  const [config, setConfig] = useState<ValidatedPresentationConfig | null>(null)
  const [isGenerating, setIsGenerating] = useState(false)
  const [isSwitchingSession, setIsSwitchingSession] = useState(false)
  const [workspaceError, setWorkspaceError] = useState<string | null>(null)
  const configRef = useRef(config)
  const setCurrentConfig = (next: ValidatedPresentationConfig | null) => {
    configRef.current = next
    setConfig(next)
  }
  const selectedSessionIdRef = useRef(localSessions.selectedSessionId)
  const activeGenerationOriginRef = useRef<GenerationOrigin | null>(null)
  const sessionSwitchTokenRef = useRef(0)
  const sessionSwitchFrameRef = useRef<number | null>(null)
  const isAppBusy = isGenerating || isSwitchingSession || localSessions.persistenceStatus === 'hydrating'
  // In-memory version history per session: each successful generation can be undone.
  const deckHistoriesRef = useRef(new Map<string, DeckHistory>())
  const preAttemptDeckRef = useRef<ValidatedPresentationConfig | null>(null)
  const [, setHistoryVersion] = useState(0)
  const deckHistory = deckHistoriesRef.current.get(localSessions.selectedSessionId)
  const persistenceInteractionBlockReason = !localSessions.canMutateLocalHistory
    ? (localSessions.persistenceStatus === 'hydrating'
      ? 'Local presentation history is still loading. Generation and session changes are disabled until recovery finishes.'
      : 'Local presentation history needs recovery. Retry, continue fresh, or clear history before generating or changing sessions.')
    : null

  useEffect(() => {
    selectedSessionIdRef.current = localSessions.selectedSessionId
  }, [localSessions.selectedSessionId])

  useEffect(() => {
    setCurrentConfig(localSessions.selectedSession.currentDeckSnapshot)
    setView(localSessions.selectedSession.currentDeckSnapshot ? 'workspace' : 'home')
  }, [localSessions.selectedSessionId])

  useEffect(() => {
    return () => {
      if (sessionSwitchFrameRef.current !== null) cancelAnimationFrame(sessionSwitchFrameRef.current)
    }
  }, [])

  const isCurrentGenerationOrigin = (origin: GenerationOrigin) => {
    const activeOrigin = activeGenerationOriginRef.current
    return Boolean(
      activeOrigin &&
      activeOrigin.sessionId === origin.sessionId &&
      selectedSessionIdRef.current === origin.sessionId &&
      activeOrigin.attemptId === origin.attemptId &&
      localSessions.sessions.some((session) => session.id === origin.sessionId),
    )
  }

  const handleGenerate = (newConfig: ValidatedPresentationConfig, origin: GenerationOrigin, committedMessages: CommittedGenerationMessage[]) => {
    if (!isCurrentGenerationOrigin(origin)) return
    const previousDeck = preAttemptDeckRef.current
    preAttemptDeckRef.current = null
    if (previousDeck && JSON.stringify(previousDeck) !== JSON.stringify(newConfig)) {
      const history = deckHistoriesRef.current.get(origin.sessionId) ?? { undo: [], redo: [] }
      deckHistoriesRef.current.set(origin.sessionId, { undo: [...history.undo, previousDeck].slice(-DECK_HISTORY_LIMIT), redo: [] })
      setHistoryVersion((version) => version + 1)
    }
    setIsSwitchingSession(false)
    localSessions.updateSessionById(origin.sessionId, (session) => {
      const firstUserMessage = session.messages.length === 0
        ? committedMessages.find((message) => message.kind === 'user')
        : undefined
      return {
        ...session,
        title: firstUserMessage ? stripBriefPreferences(firstUserMessage.text).trim().slice(0, 60) || session.title : session.title,
        currentDeckSnapshot: newConfig,
      }
    }, { flush: true })
    localSessions.appendMessagesToSession(origin.sessionId, committedMessages, { flush: true })
    setIsGenerating(false)
    activeGenerationOriginRef.current = null
    setWorkspaceError(null)
    selectedSessionIdRef.current = origin.sessionId
    setCurrentConfig(newConfig)
    setView('workspace')
  }

  const handleConversation = (origin: GenerationOrigin, messages: CommittedGenerationMessage[]) => {
    if (!isCurrentGenerationOrigin(origin)) return
    localSessions.appendMessagesToSession(origin.sessionId, messages, { flush: true })
    activeGenerationOriginRef.current = null
    setIsGenerating(false)
    setWorkspaceError(null)
  }

  const handleGeneratingStateChange = (generating: boolean, origin: GenerationOrigin) => {
    if (generating) {
      activeGenerationOriginRef.current = origin
      preAttemptDeckRef.current = configRef.current
      selectedSessionIdRef.current = origin.sessionId
      setIsGenerating(true)
      setIsSwitchingSession(false)
      setWorkspaceError(null)
      return
    }

    if (activeGenerationOriginRef.current?.attemptId !== origin.attemptId) return
    activeGenerationOriginRef.current = null
    setIsGenerating(false)
  }

  const staleActionResult = (deck: ValidatedPresentationConfig | null, reason: string): ApplyPresentationActionResult => {
    const diagnostics = [{ code: 'stale-generation-origin', message: reason }]
    return {
      ok: false,
      deck,
      diagnostics,
      error: createAppError({ category: 'validation', diagnostics }) as GenerationError,
    }
  }

  const handlePresentationAction = (action: PresentationAction, origin: GenerationOrigin) => {
    if (!isCurrentGenerationOrigin(origin)) {
      return staleActionResult(config, 'Ignored a streamed presentation action from a stale or non-selected generation attempt.')
    }
    const result = applyPresentationAction(configRef.current, action)
    if (result.ok) {
      setCurrentConfig(result.deck)
      localSessions.updateSelectedSession((session) => ({ ...session, currentDeckSnapshot: result.deck }), { flush: true })
      localSessions.recordActionInSelected({ action, summary: describePresentationAction(action), result: 'applied' }, { flush: true })
      setWorkspaceError(null)
    } else {
      setWorkspaceError(getUserErrorMessage(result.error))
    }
    return result
  }

  const restoreDeckVersion = (direction: 'undo' | 'redo') => {
    const sessionId = localSessions.selectedSessionId
    const current = configRef.current
    const history = deckHistoriesRef.current.get(sessionId)
    if (!current || !history || isGenerating || isSwitchingSession || !localSessions.canMutateLocalHistory) return
    const source = direction === 'undo' ? history.undo : history.redo
    const target = source[source.length - 1]
    if (!target) return
    const remaining = source.slice(0, -1)
    deckHistoriesRef.current.set(sessionId, direction === 'undo'
      ? { undo: remaining, redo: [...history.redo, current] }
      : { undo: [...history.undo, current], redo: remaining })
    setHistoryVersion((version) => version + 1)
    setCurrentConfig(target)
    localSessions.updateSelectedSession((session) => ({ ...session, currentDeckSnapshot: target }), { flush: true })
    localSessions.appendMessageToSelected({ kind: 'status', text: direction === 'undo' ? 'Restored the previous version of the deck.' : 'Reapplied the undone change.' }, { flush: true })
    setWorkspaceError(null)
  }

  const handleReset = () => {
    if (!localSessions.canMutateLocalHistory || isGenerating) return
    selectedSessionIdRef.current = localSessions.createAndSelectSession()
    setCurrentConfig(null)
    setIsGenerating(false)
    setIsSwitchingSession(false)
    setWorkspaceError(null)
    setView('home')
  }

  const handleSelectSession = (sessionId: string) => {
    if (isGenerating) {
      setWorkspaceError('Session switching is disabled while generation is active. Cancel or wait for the current generation before switching sessions.')
      return
    }
    if (!localSessions.canMutateLocalHistory) return
    const session = localSessions.sessions.find((candidate) => candidate.id === sessionId)
    if (!session) {
      setWorkspaceError('That saved presentation session could not be found. Your current presentation was left unchanged.')
      return
    }
    sessionSwitchTokenRef.current += 1
    const switchToken = sessionSwitchTokenRef.current
    if (sessionSwitchFrameRef.current !== null) cancelAnimationFrame(sessionSwitchFrameRef.current)
    setIsSwitchingSession(true)
    selectedSessionIdRef.current = sessionId
    localSessions.selectSession(sessionId)
    setCurrentConfig(session.currentDeckSnapshot ?? null)
    setWorkspaceError(null)
    setIsGenerating(false)
    setView(session.currentDeckSnapshot ? 'workspace' : 'home')
    sessionSwitchFrameRef.current = requestAnimationFrame(() => {
      if (sessionSwitchTokenRef.current === switchToken) setIsSwitchingSession(false)
      if (sessionSwitchFrameRef.current !== null) sessionSwitchFrameRef.current = null
    })
  }

  const handleClearHistory = () => {
    if (isGenerating || isSwitchingSession) return
    if (!localSessions.clearHistory()) return
    deckHistoriesRef.current.clear()
    setCurrentConfig(null)
    setIsGenerating(false)
    setIsSwitchingSession(false)
    setWorkspaceError(null)
    setView('home')
  }

  const handleRevealError = useCallback((error: RenderError) => {
    setWorkspaceError(getUserErrorMessage(error))
  }, [])

  return (
    <div className="app" aria-busy={isAppBusy ? 'true' : undefined}>
      {view === 'home' ? (
        <main className="app-home">
          <header className="home-header app-container">
            <a className="brand" href="#main-content"><span className="brand-mark" aria-hidden="true">M</span>Magic Slider</a>
            <div className="home-header__links">
              <a className="home-v2-link" href="../">Back to Studio v2 <span aria-hidden="true">→</span></a>
              <span className="local-badge"><span aria-hidden="true" />Saved in your browser</span>
            </div>
          </header>
          <section className="hero" id="main-content">
            <div className="app-container hero-content">
              <p className="eyebrow">YOUR NEXT GREAT PRESENTATION STARTS HERE</p>
              <h1 className="hero-title">A rough idea.<br /><span>A clear story.</span></h1>
              <p className="hero-description">Describe what you need. Magic Slider researches the facts, designs the visuals and writes the slides — then keeps refining them with you.</p>
            </div>
          </section>

          <section className="chat-section">
            <div className="app-container">
              <div className="chat-wrapper">
                <Chatbot
                  key={localSessions.selectedSessionId}
                  sessionId={localSessions.selectedSessionId}
                  onGenerate={handleGenerate}
                  onConversation={handleConversation}
                  onPresentationAction={handlePresentationAction}
                  onGeneratingStateChange={handleGeneratingStateChange}
                  sessionMessages={localSessions.selectedSession.messages}
                  onAppendSessionMessage={localSessions.appendMessageToSelected}
                  disabledReason={persistenceInteractionBlockReason}
                />
                <PersistenceNotice
                  status={localSessions.persistenceStatus}
                  error={localSessions.persistenceError}
                  failureKind={localSessions.persistenceFailureKind}
                  busy={isGenerating || isSwitchingSession}
                  onRetry={localSessions.retryPersistenceHydration}
                  onContinueFresh={localSessions.continueFreshAfterPersistenceFailure}
                  onClear={handleClearHistory}
                />
                <ul className="feature-list" aria-label="What Magic Slider does">
                  {features.map((feature) => (
                    <li key={feature.title} className="feature-list__item">
                      <strong>{feature.title}</strong>
                      <span>{feature.text}</span>
                    </li>
                  ))}
                </ul>
                <section className="home-session-panel" aria-label="Recent Sessions">
                  <SessionList
                    variant="home"
                    sessions={localSessions.sessionSummaries}
                    selectedSessionId={localSessions.selectedSessionId}
                    disabled={isSwitchingSession || isGenerating || !localSessions.canMutateLocalHistory}
                    clearDisabled={isSwitchingSession || isGenerating || localSessions.persistenceStatus === 'hydrating'}
                    onSelect={handleSelectSession}
                    onClear={handleClearHistory}
                  />
                  <p className="home-session-panel__copy">Your recent conversations and decks, saved on this device.</p>
                </section>
              </div>
            </div>
          </section>
          <footer className="home-footer">From first thought to final slide.</footer>
        </main>
      ) : (
        <Suspense fallback={<div className="workspace-loading" role="status">Opening your presentation…</div>}>
        <Workspace
          config={config}
          isGenerating={isGenerating}
          isSwitchingSession={isSwitchingSession}
          error={workspaceError}
          onGenerate={handleGenerate}
          onConversation={handleConversation}
          onPresentationAction={handlePresentationAction}
          onGeneratingStateChange={handleGeneratingStateChange}
          onReset={handleReset}
          onRevealError={handleRevealError}
          sessionMessages={localSessions.selectedSession.messages}
          sessionSummaries={localSessions.sessionSummaries}
          selectedSessionId={localSessions.selectedSessionId}
          selectedSessionTitle={localSessions.selectedSession.title}
          onSelectSession={handleSelectSession}
          onClearHistory={handleClearHistory}
          onRetryPersistence={localSessions.retryPersistenceHydration}
          onContinueFresh={localSessions.continueFreshAfterPersistenceFailure}
          persistenceStatus={localSessions.persistenceStatus}
          persistenceError={localSessions.persistenceError}
          persistenceFailureKind={localSessions.persistenceFailureKind}
          canMutateLocalHistory={localSessions.canMutateLocalHistory}
          onAppendSessionMessage={localSessions.appendMessageToSelected}
          canUndo={Boolean(deckHistory?.undo.length)}
          canRedo={Boolean(deckHistory?.redo.length)}
          onUndo={() => restoreDeckVersion('undo')}
          onRedo={() => restoreDeckVersion('redo')}
        />
        </Suspense>
      )}
    </div>
  )
}

export default App
