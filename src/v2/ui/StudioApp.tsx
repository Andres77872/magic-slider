import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { flushSync } from 'react-dom'

import { generate, type ChatTurn } from '../agent/agentClient'
import { getV2Config } from '../config'
import { deckTitle, type Deck } from '../domain/deckSchema'
import { normalizeDeck, type DeckDiagnostic } from '../domain/normalize'
import { applyOperations, type DeckOperation } from '../domain/operations'
import { deckFileName, downloadFile } from '../render/download'
import { measureFitScales, type FitScales } from '../render/fit'
import { resolveTheme, themePresetNames, type ThemePresetName } from '../render/theme'
import { createMessage, useSessions, type ChatMessage } from '../session/sessions'
import type { DeckTemplate } from '../templates'
import { getUserErrorMessage, type AppError } from '../../lib/errors'
import type { Block } from '../catalog/types'
import ChatPanel, { type GenerationProgress } from './ChatPanel'
import DeckStage, { type StageNavigation } from './DeckStage'
import HomeView from './HomeView'
import Inspector from './Inspector'
import PrimitiveGallery from './PrimitiveGallery'
import SlideOverview from './SlideOverview'
import SlideRail from './SlideRail'

type View = 'home' | 'studio' | 'gallery'
type History = { undo: Deck[]; redo: Deck[] }
type Notice = { kind: 'success' | 'error'; text: string }

const HISTORY_LIMIT = 40

function isAppError(value: unknown): value is AppError {
  return Boolean(value && typeof value === 'object' && 'category' in value && 'recovery' in value)
}

function findBlock(blocks: readonly Block[], id: string): Block | null {
  for (const block of blocks) {
    if (block.id === id) return block
    const nested = block.children ? findBlock(block.children, id) : null
    if (nested) return nested
  }
  return null
}

function summarizeDiagnostics(diagnostics: DeckDiagnostic[]): string[] {
  return diagnostics.filter((item) => item.severity !== 'info').slice(0, 12).map((item) => `${item.message}${item.path ? ` (${item.path})` : ''}`)
}

export default function StudioApp() {
  const sessions = useSessions()
  const session = sessions.current
  const [view, setView] = useState<View>(() => (session.deck ? 'studio' : 'home'))
  const [previewDeck, setPreviewDeck] = useState<Deck | null>(null)
  const [progress, setProgress] = useState<GenerationProgress | null>(null)
  const [homeError, setHomeError] = useState<string | null>(null)
  const [slideIndex, setSlideIndex] = useState(0)
  const [navigation, setNavigation] = useState<StageNavigation | null>(null)
  const [selectedBlockId, setSelectedBlockId] = useState<string | null>(null)
  const [diagnostics, setDiagnostics] = useState<DeckDiagnostic[]>([])
  const [fitScales, setFitScales] = useState<FitScales>({})
  const [notice, setNotice] = useState<Notice | null>(null)
  const [showInspector, setShowInspector] = useState(true)
  const [showOverview, setShowOverview] = useState(false)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [exporting, setExporting] = useState(false)
  const historyRef = useRef(new Map<string, History>())
  const [, setHistoryVersion] = useState(0)
  const controllerRef = useRef<AbortController | null>(null)
  const stageWrapRef = useRef<HTMLDivElement>(null)

  const deck = previewDeck ?? session.deck
  const busy = Boolean(progress)
  const themeKey = JSON.stringify(deck?.theme ?? null)
  const theme = useMemo(() => resolveTheme(JSON.parse(themeKey) ?? undefined), [themeKey])
  const activeIndex = deck ? Math.min(slideIndex, deck.slides.length - 1) : 0
  const activeSlide = deck?.slides[activeIndex] ?? null
  const history = historyRef.current.get(session.id)
  const selectedBlock = activeSlide && selectedBlockId ? findBlock(activeSlide.blocks, selectedBlockId) : null

  useEffect(() => {
    if (view === 'studio' && !session.deck && !previewDeck && !busy) setView('home')
  }, [view, session.deck, previewDeck, busy])

  // Auto-fit is measured off-screen once fonts are ready, then passed to every renderer.
  useEffect(() => {
    if (!deck) return undefined
    let cancelled = false
    const measure = () => {
      if (cancelled) return
      const next = measureFitScales(deck, theme)
      setFitScales((current) => (JSON.stringify(current) === JSON.stringify(next) ? current : next))
    }
    measure()
    void document.fonts?.ready.then(measure)
    return () => {
      cancelled = true
    }
  }, [deck, theme])

  useEffect(() => {
    if (notice?.kind !== 'success') return undefined
    const timer = window.setTimeout(() => setNotice(null), 7000)
    return () => window.clearTimeout(timer)
  }, [notice])

  useEffect(() => {
    const onChange = () => setIsFullscreen(document.fullscreenElement === stageWrapRef.current)
    document.addEventListener('fullscreenchange', onChange)
    return () => document.removeEventListener('fullscreenchange', onChange)
  }, [])

  const commitDeck = useCallback((sessionId: string, next: Deck, previous: Deck | null) => {
    if (previous && JSON.stringify(previous) !== JSON.stringify(next)) {
      const entry = historyRef.current.get(sessionId) ?? { undo: [], redo: [] }
      historyRef.current.set(sessionId, { undo: [...entry.undo, previous].slice(-HISTORY_LIMIT), redo: [] })
      setHistoryVersion((version) => version + 1)
    }
    sessions.setDeck(sessionId, next)
  }, [sessions])

  const restore = useCallback((direction: 'undo' | 'redo') => {
    const entry = historyRef.current.get(session.id)
    if (!entry || !session.deck || busy) return
    const source = direction === 'undo' ? entry.undo : entry.redo
    const target = source[source.length - 1]
    if (!target) return
    historyRef.current.set(session.id, direction === 'undo'
      ? { undo: entry.undo.slice(0, -1), redo: [...entry.redo, session.deck] }
      : { undo: [...entry.undo, session.deck], redo: entry.redo.slice(0, -1) })
    setHistoryVersion((version) => version + 1)
    sessions.setDeck(session.id, target)
    sessions.appendMessages(session.id, [createMessage('status', direction === 'undo' ? 'Restored the previous version.' : 'Reapplied the undone change.')])
  }, [session, busy, sessions])

  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      if (target && (target.tagName === 'TEXTAREA' || target.tagName === 'INPUT' || target.isContentEditable)) return
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== 'z') return
      event.preventDefault()
      restore(event.shiftKey ? 'redo' : 'undo')
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [restore])

  const runGeneration = async (prompt: string) => {
    if (busy) return
    let config
    try {
      config = getV2Config()
    } catch (error) {
      const message = isAppError(error) ? `${getUserErrorMessage(error)} ${error.diagnostics?.[0]?.message ?? ''}` : String(error)
      if (view === 'home') setHomeError(message)
      else sessions.appendMessages(session.id, [createMessage('error', message)])
      return
    }
    const sessionId = session.id
    const baseDeck = session.deck
    const historyTurns: ChatTurn[] = session.messages
      .filter((message): message is ChatMessage & { role: 'user' | 'assistant' } => message.role === 'user' || message.role === 'assistant')
      .map((message) => ({ role: message.role, content: message.text }))
    setHomeError(null)
    sessions.renameFromPrompt(sessionId, prompt.split('\n\nPresentation preferences:')[0])
    sessions.appendMessages(sessionId, [createMessage('user', prompt)])
    const controller = new AbortController()
    controllerRef.current = controller
    setProgress({ phase: 'sending', startedAt: Date.now() })
    setDiagnostics([])

    const result = await generate({
      prompt,
      config,
      deck: baseDeck,
      history: historyTurns,
      focusedSlideId: baseDeck ? activeSlide?.id : null,
      fitScales: baseDeck ? fitScales : undefined,
      signal: controller.signal,
      onPhase: (phase, detail) => setProgress((current) => ({ phase, detail, startedAt: current?.startedAt ?? Date.now() })),
      onPreview: (partial) => {
        if (baseDeck) return
        setPreviewDeck(partial)
        setView('studio')
      },
    })

    controllerRef.current = null
    setProgress(null)
    setPreviewDeck(null)

    if (result.ok && result.kind === 'deck') {
      commitDeck(sessionId, result.deck, baseDeck)
      setDiagnostics(result.diagnostics)
      const warnings = summarizeDiagnostics(result.diagnostics)
      const summary = result.message ?? (result.created
        ? `Created “${deckTitle(result.deck)}” with ${result.deck.slides.length} slides.`
        : `Applied ${result.appliedOperations} change${result.appliedOperations === 1 ? '' : 's'}.`)
      const messages = [createMessage('assistant', summary)]
      if (result.failedOperations.length) {
        messages.push(createMessage('error', `${result.failedOperations.length} requested change${result.failedOperations.length === 1 ? ' was' : 's were'} skipped.`, result.failedOperations.map((failure) => failure.message)))
      }
      if (warnings.length) messages.push(createMessage('status', 'Some generated content was adjusted to fit the renderer.', warnings))
      sessions.appendMessages(sessionId, messages)
      if (result.created) {
        setSlideIndex(0)
        setNavigation({ index: 0, nonce: Date.now() })
        setSelectedBlockId(null)
      }
      setView('studio')
      return
    }
    if (result.ok) {
      sessions.appendMessages(sessionId, [createMessage('assistant', result.message)])
      if (view === 'home' && !baseDeck) setHomeError(result.message)
      return
    }
    if (result.error.category === 'cancellation') {
      sessions.appendMessages(sessionId, [createMessage('status', 'Cancelled. Nothing was changed.')])
      return
    }
    const message = `${getUserErrorMessage(result.error)} ${result.error.recovery ?? ''}`.trim()
    const details = (result.error.diagnostics ?? []).map((item) => item.message).filter(Boolean)
    if (!baseDeck && result.partialDeck) {
      commitDeck(sessionId, result.partialDeck, null)
      sessions.appendMessages(sessionId, [createMessage('error', `${message} Kept the ${result.partialDeck.slides.length} slides that finished before the problem.`, details)])
      setView('studio')
      return
    }
    sessions.appendMessages(sessionId, [createMessage('error', message, details)])
    if (!baseDeck) setHomeError(message)
  }

  const cancel = () => controllerRef.current?.abort()

  const applyLocalOperations = (operations: DeckOperation[], summary: string): string | null => {
    if (!session.deck || busy) return 'Wait for the current request to finish.'
    const result = applyOperations(session.deck, operations)
    if (!result.applied.length) return result.failed[0]?.message ?? 'Nothing changed.'
    commitDeck(session.id, result.deck, session.deck)
    setDiagnostics(result.diagnostics)
    sessions.appendMessages(session.id, [createMessage('status', summary)])
    return result.failed.length ? result.failed.map((failure) => failure.message).join(' ') : null
  }

  const replaceDeckFromJson = (json: string): string | null => {
    let parsed: unknown
    try {
      parsed = JSON.parse(json)
    } catch (cause) {
      return `Invalid JSON: ${String(cause)}`
    }
    const result = normalizeDeck(parsed)
    if (!result.deck) return result.diagnostics.map((item) => item.message).join(' ')
    commitDeck(session.id, result.deck, session.deck)
    setDiagnostics(result.diagnostics)
    sessions.appendMessages(session.id, [createMessage('status', 'Applied the edited deck JSON.', summarizeDiagnostics(result.diagnostics))])
    return null
  }

  const startFromDeck = (raw: unknown, label: string) => {
    const result = normalizeDeck(raw)
    if (!result.deck) {
      setHomeError(`${label} could not be opened: ${result.diagnostics.map((item) => item.message).join(' ')}`)
      return
    }
    const id = sessions.createAndSelect(result.deck)
    sessions.appendMessages(id, [createMessage('status', `Opened ${label}.`, summarizeDiagnostics(result.diagnostics))])
    setDiagnostics(result.diagnostics)
    setSlideIndex(0)
    setNavigation(null)
    setSelectedBlockId(null)
    setView('studio')
  }

  const openTemplate = (template: DeckTemplate) => startFromDeck(template.deck, `the “${template.title}” template`)
  const importJson = (json: string, fileName: string) => {
    try {
      startFromDeck(JSON.parse(json), fileName)
    } catch (cause) {
      setHomeError(`${fileName} is not valid JSON (${String(cause)}).`)
    }
  }

  const newPresentation = () => {
    if (busy) return
    sessions.createAndSelect(null)
    setSelectedBlockId(null)
    setSlideIndex(0)
    setNavigation(null)
    setDiagnostics([])
    setView('home')
  }

  const openSession = (id: string) => {
    if (busy) return
    sessions.select(id)
    setSelectedBlockId(null)
    setSlideIndex(0)
    setNavigation(null)
    setDiagnostics([])
    setView('studio')
  }

  const goToSlide = (index: number) => {
    setSlideIndex(index)
    setSelectedBlockId(null)
    setNavigation({ index, nonce: Date.now() })
  }

  const moveSlide = (slideId: string, afterSlideId: string | null) => {
    applyLocalOperations([{ op: 'move_slide', slideId, after: afterSlideId }], `Moved slide ${slideId}.`)
  }

  const setThemePreset = (preset: ThemePresetName) => {
    applyLocalOperations([{ op: 'update_deck', set: { theme: { preset } } }], `Switched to the ${preset} theme.`)
  }

  const exportJson = () => {
    if (!session.deck) return
    downloadFile(JSON.stringify(session.deck, null, 2), deckFileName(session.deck, 'json'), 'application/json')
    setNotice({ kind: 'success', text: `Downloaded ${deckFileName(session.deck, 'json')}.` })
  }

  const exportHtml = async () => {
    if (!session.deck || exporting) return
    setExporting(true)
    try {
      const { exportDeckWithAssets } = await import('../render/exportDeck')
      const result = await exportDeckWithAssets(session.deck, { fitScales })
      downloadFile(result.html, deckFileName(session.deck, 'html'), 'text/html;charset=utf-8')
      const parts = [`Downloaded ${deckFileName(session.deck, 'html')}.`]
      if (result.embeddedImages) parts.push(`${result.embeddedImages} image${result.embeddedImages === 1 ? '' : 's'} embedded.`)
      if (result.linkedImages) parts.push(`${result.linkedImages} image${result.linkedImages === 1 ? '' : 's'} stay linked and need a connection.`)
      setNotice({ kind: 'success', text: parts.join(' ') })
    } catch {
      setNotice({ kind: 'error', text: 'The presentation could not be exported. Export JSON to keep your work.' })
    } finally {
      setExporting(false)
    }
  }

  const present = async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen()
      else {
        // The stage is hidden while the overview is open; reveal it synchronously so
        // requestFullscreen still runs inside the click's user activation.
        if (showOverview) flushSync(() => setShowOverview(false))
        await stageWrapRef.current?.requestFullscreen()
        stageWrapRef.current?.querySelector<HTMLElement>('.v2-stage')?.focus()
      }
    } catch {
      setNotice({ kind: 'error', text: 'Fullscreen is not available here; you can still navigate the preview.' })
    }
  }

  if (view === 'gallery') return <PrimitiveGallery onClose={() => setView(session.deck ? 'studio' : 'home')} />

  if (view === 'home' || !deck) {
    return (
      <div className="v2-app">
        <header className="v2-topbar">
          <a className="v2-brand" href="./" onClick={(event) => { event.preventDefault(); setView('home') }}><span className="v2-brand__mark">M</span>Magic Slider <span className="v2-brand__tag">v2</span></a>
          <nav className="v2-topbar__nav">
            <button type="button" className="v2-link" onClick={() => setView('gallery')}>Primitives</button>
            <a className="v2-link" href="./v1/">Classic v1</a>
          </nav>
        </header>
        {sessions.persistenceError && <p className="v2-alert v2-alert--banner" role="alert">{sessions.persistenceError}</p>}
        <HomeView
          sessions={sessions.summaries}
          busy={busy}
          error={homeError}
          onGenerate={(prompt) => void runGeneration(prompt)}
          onTemplate={openTemplate}
          onImport={importJson}
          onOpenSession={openSession}
          onDeleteSession={(id) => { sessions.remove(id); setHomeError(null) }}
          onOpenGallery={() => setView('gallery')}
        />
        {busy && <div className="v2-home__progress" role="status">{progress?.phase === 'thinking' ? 'Researching and designing…' : 'Composing your presentation…'} <button type="button" className="v2-link" onClick={cancel}>Cancel</button></div>}
      </div>
    )
  }

  const selectedLabel = selectedBlock ? `${selectedBlock.type} ${selectedBlock.id}` : undefined
  const slideLabel = activeSlide ? `slide ${activeIndex + 1}${activeSlide.name ? ` · ${activeSlide.name}` : ''}` : undefined
  const canEdit = Boolean(session.deck) && !busy

  return (
    <div className={`v2-app v2-app--studio${showInspector ? '' : ' v2-app--no-inspector'}`}>
      <header className="v2-topbar">
        <a className="v2-brand" href="./" onClick={(event) => { event.preventDefault(); newPresentation() }} title="New presentation"><span className="v2-brand__mark">M</span><span className="v2-brand__name">Magic Slider</span> <span className="v2-brand__tag">v2</span></a>
        <div className="v2-topbar__title">
          <h1>{deckTitle(deck)}</h1>
          <span className="v2-muted">{deck.slides.length} slides · {theme.preset}</span>
        </div>
        <div className="v2-toolbar" role="toolbar" aria-label="Presentation actions">
          <button type="button" className="v2-icon-button" aria-label="Undo" title="Undo (Ctrl+Z)" disabled={!history?.undo.length || !canEdit} onClick={() => restore('undo')}>↶</button>
          <button type="button" className="v2-icon-button" aria-label="Redo" title="Redo (Ctrl+Shift+Z)" disabled={!history?.redo.length || !canEdit} onClick={() => restore('redo')}>↷</button>
          <label className="v2-visually-hidden" htmlFor="v2-theme-select">Theme</label>
          <select id="v2-theme-select" className="v2-input v2-input--compact" value={theme.preset} disabled={!canEdit} onChange={(event) => setThemePreset(event.target.value as ThemePresetName)}>
            {themePresetNames.map((name) => <option key={name} value={name}>{name}</option>)}
          </select>
          <button type="button" className="v2-button v2-button--ghost" aria-pressed={showOverview} onClick={() => setShowOverview((open) => !open)}>Overview</button>
          <button type="button" className="v2-button v2-button--ghost" aria-pressed={showInspector} onClick={() => setShowInspector((open) => !open)}>Inspector</button>
          <button type="button" className="v2-button v2-button--ghost" disabled={!session.deck} onClick={exportJson}>JSON</button>
          <button type="button" className="v2-button v2-button--ghost" disabled={!session.deck || exporting} onClick={() => void exportHtml()}>{exporting ? 'Exporting…' : 'Export HTML'}</button>
          {document.fullscreenEnabled && <button type="button" className="v2-button v2-button--primary" disabled={!session.deck} onClick={() => void present()}>{isFullscreen ? 'Exit' : 'Present'} ▶</button>}
          <button type="button" className="v2-button v2-button--ghost" disabled={busy} onClick={newPresentation}>New</button>
          <button type="button" className="v2-link" onClick={() => setView('gallery')}>Primitives</button>
          <a className="v2-link" href="./v1/">v1</a>
        </div>
      </header>
      {notice && <p className={`v2-alert v2-alert--banner v2-alert--${notice.kind}`} role={notice.kind === 'error' ? 'alert' : 'status'}>{notice.text}</p>}
      {sessions.persistenceError && <p className="v2-alert v2-alert--banner" role="alert">{sessions.persistenceError}</p>}

      <div className="v2-workspace">
        <ChatPanel
          messages={session.messages}
          progress={progress}
          focusedSlideLabel={slideLabel}
          selectedBlockLabel={selectedLabel}
          onSend={(prompt) => void runGeneration(selectedBlock ? `${prompt}\n\n(Selected block: ${selectedBlock.id} on slide ${activeSlide?.id})` : prompt)}
          onCancel={cancel}
        />
        <main className="v2-canvas" id="main" aria-label="Presentation preview">
          {showOverview && <SlideOverview deck={deck} theme={theme} fitScales={fitScales} activeIndex={activeIndex} onOpen={(index) => { setShowOverview(false); goToSlide(index) }} />}
          <div className="v2-canvas__stage" ref={stageWrapRef} hidden={showOverview}>
            <DeckStage
              deck={deck}
              fitScales={fitScales}
              navigation={navigation}
              selectedBlockId={selectedBlockId}
              building={Boolean(previewDeck)}
              onSlideChange={(index) => setSlideIndex(index)}
              onBlockSelect={(blockId) => setSelectedBlockId(blockId)}
              onError={(message) => setNotice({ kind: 'error', text: message })}
            />
            {previewDeck && <p className="v2-canvas__building" role="status">Building live · {previewDeck.slides.length} slide{previewDeck.slides.length === 1 ? '' : 's'} ready</p>}
          </div>
          {!showOverview && <SlideRail
            deck={deck}
            theme={theme}
            fitScales={fitScales}
            activeIndex={activeIndex}
            disabled={!canEdit}
            onSelect={goToSlide}
            onMove={moveSlide}
          />}
        </main>
        {showInspector && (
          <Inspector
            deck={deck}
            slide={activeSlide}
            selectedBlockId={selectedBlockId}
            diagnostics={diagnostics}
            fitScale={activeSlide ? fitScales[activeSlide.id] : undefined}
            disabled={!canEdit}
            onSelectBlock={setSelectedBlockId}
            onApplyOperations={applyLocalOperations}
            onReplaceDeck={replaceDeckFromJson}
          />
        )}
      </div>
    </div>
  )
}

