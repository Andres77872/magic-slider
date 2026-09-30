import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { flushSync } from 'react-dom'

import { generate, type ChatTurn } from '../agent/agentClient'
import { resolveMentions, resolveReference, snapshotReference, type ResolvedReference } from '../agent/references'
import type { Block } from '../catalog/types'
import { getV2Config } from '../config'
import { deckTitle, type Deck, type Slide } from '../domain/deckSchema'
import { diffDecks } from '../domain/diff'
import {
  addSlide, deleteBlock, deleteSlide, duplicateBlock, duplicateSlide, insertPrimitive, insertionPoint, moveBlockBy, moveSlideBy, moveSlideTo,
  pasteBlocks, pasteSlide, setBlockProps, setDeckProps, setSlideProps, type EditorCommand,
} from '../domain/editorCommands'
import { normalizeDeck, type DeckDiagnostic } from '../domain/normalize'
import { applyOperations, type DeckOperation } from '../domain/operations'
import { getSlideStarter } from '../domain/slideStarters'
import { findSlide, locateBlock, stripBlockIds } from '../domain/tree'
import { deckFileName, downloadFile } from '../render/download'
import { measureFitScales, type FitScales } from '../render/fit'
import { resolveTheme, themePresetNames } from '../render/theme'
import { createMessage, useSessions, type ChatMessage } from '../session/sessions'
import type { DeckTemplate } from '../templates'
import { getUserErrorMessage, type AppError } from '../../lib/errors'
import ChatPanel, { type GenerationProgress } from './chat/ChatPanel'
import type { ComposerHandle, SendOptions } from './chat/Composer'
import Icon, { primitiveIcons } from './common/Icon'
import { MenuButton, type MenuItem } from './common/Popover'
import ShortcutsDialog, { MOD } from './common/ShortcutsDialog'
import { ToastRegion, useToasts } from './common/Toasts'
import DeckStage, { type StageNavigation } from './DeckStage'
import EditCanvas from './editor/EditCanvas'
import { supportsInlineEdit } from './editor/inlineEdit'
import InsertMenu from './editor/InsertMenu'
import HomeView from './HomeView'
import Inspector, { type InspectorTab } from './inspector/Inspector'
import type { LayerAction } from './inspector/LayersPanel'
import PrimitiveGallery from './PrimitiveGallery'
import SlideOverview from './SlideOverview'
import SlideRail, { type SlideAction } from './SlideRail'

type View = 'home' | 'studio' | 'gallery'
type Mode = 'edit' | 'preview' | 'grid'
type History = { undo: Deck[]; redo: Deck[] }
type Clipboard = { kind: 'block'; block: Block } | { kind: 'slide'; slide: Slide }
interface AgentTurn { sessionId: string; messageId: string; before: Deck; after: Deck }

const HISTORY_LIMIT = 60
const CLIPBOARD_TAG = 'magic-slider/v2'

function isAppError(value: unknown): value is AppError {
  return Boolean(value && typeof value === 'object' && 'category' in value && 'recovery' in value)
}

function summarizeDiagnostics(diagnostics: DeckDiagnostic[]): string[] {
  return diagnostics.filter((item) => item.severity !== 'info').slice(0, 12).map((item) => `${item.message}${item.path ? ` (${item.path})` : ''}`)
}

/** Whether a key event belongs to a text field, where editor shortcuts must not fire. */
function isTypingTarget(target: EventTarget | null): boolean {
  const element = target instanceof HTMLElement ? target : null
  if (!element) return false
  return element.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(element.tagName)
}

/** Widgets that own their arrow keys and Escape (menus, lists, trees, dialogs). */
function isWidgetTarget(target: EventTarget | null): boolean {
  const element = target instanceof Element ? target : null
  return Boolean(element?.closest('[role="menu"], [role="listbox"], [role="tree"], [role="tablist"], [role="radiogroup"], dialog, .v2-popover'))
}

function parseClipboard(text: string): Clipboard | null {
  try {
    const value = JSON.parse(text) as { app?: string; kind?: string; block?: Block; slide?: Slide }
    if (value?.app !== CLIPBOARD_TAG) return null
    if (value.kind === 'block' && value.block && typeof value.block.type === 'string') return { kind: 'block', block: value.block }
    if (value.kind === 'slide' && value.slide && Array.isArray(value.slide.blocks)) return { kind: 'slide', slide: value.slide }
  } catch {
    // Not ours: ordinary text is not pasted onto the canvas.
  }
  return null
}

export default function StudioApp() {
  const sessions = useSessions()
  const session = sessions.current
  const [view, setView] = useState<View>(() => (session.deck ? 'studio' : 'home'))
  const [mode, setMode] = useState<Mode>('edit')
  const [previewDeck, setPreviewDeck] = useState<Deck | null>(null)
  const [progress, setProgress] = useState<GenerationProgress | null>(null)
  const [homeError, setHomeError] = useState<string | null>(null)
  const [activeSlideId, setActiveSlideId] = useState<string | null>(null)
  const [navigation, setNavigation] = useState<StageNavigation | null>(null)
  const [selectedBlockId, setSelectedBlockId] = useState<string | null>(null)
  const [editingBlockId, setEditingBlockId] = useState<string | null>(null)
  const [diagnostics, setDiagnostics] = useState<DeckDiagnostic[]>([])
  const [fitScales, setFitScales] = useState<FitScales>({})
  // Below 1181px the inspector overlays the canvas, so it starts closed there.
  const [showInspector, setShowInspector] = useState(() => typeof window === 'undefined' || typeof window.matchMedia !== 'function' || window.matchMedia('(min-width: 1181px)').matches)
  const [chatCollapsed, setChatCollapsed] = useState(false)
  const [inspectorTab, setInspectorTab] = useState<InspectorTab>('design')
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [insertOpen, setInsertOpen] = useState(false)
  const [shortcutsOpen, setShortcutsOpen] = useState(false)
  const [clipboard, setClipboard] = useState<Clipboard | null>(null)
  const [titleDraft, setTitleDraft] = useState<string | null>(null)
  const [agentTurn, setAgentTurn] = useState<AgentTurn | null>(null)
  const historyRef = useRef(new Map<string, History>())
  const [, setHistoryVersion] = useState(0)
  const controllerRef = useRef<AbortController | null>(null)
  const stageWrapRef = useRef<HTMLDivElement>(null)
  const composerRef = useRef<ComposerHandle>(null)
  const insertButtonRef = useRef<HTMLButtonElement>(null)
  const followStream = useRef(true)
  const modeBeforePresent = useRef<Mode>('edit')
  const toasts = useToasts()

  // The latest committed deck, so consecutive edits in one tick and agent results build on each other.
  const deckRef = useRef<Deck | null>(session.deck)
  const deckSessionRef = useRef(session.id)
  if (deckSessionRef.current !== session.id) {
    deckSessionRef.current = session.id
    deckRef.current = session.deck
  }
  useEffect(() => {
    deckRef.current = session.deck
  }, [session.deck])

  const deck = previewDeck ?? session.deck
  const busy = Boolean(progress)
  const creating = busy && !session.deck
  const canEdit = Boolean(session.deck) && !creating
  const themeKey = JSON.stringify(deck?.theme ?? null)
  const theme = useMemo(() => resolveTheme(JSON.parse(themeKey) ?? undefined), [themeKey])
  const activeFound = deck && activeSlideId ? findSlide(deck, activeSlideId) : null
  const activeIndex = activeFound ? activeFound.index : 0
  const activeIndexRef = useRef(activeIndex)
  activeIndexRef.current = activeIndex
  const activeSlide = deck ? activeFound?.slide ?? deck.slides[0] ?? null : null
  const located = deck && selectedBlockId ? locateBlock(deck, selectedBlockId) : null
  const selectedBlock = located && activeSlide && located.slide.id === activeSlide.id ? located.block : null
  const history = historyRef.current.get(session.id)
  const selection: ResolvedReference | null = deck && activeSlide ? resolveReference(deck, selectedBlock?.id ?? activeSlide.id) : null

  useEffect(() => {
    if (view === 'studio' && !session.deck && !previewDeck && !busy) setView('home')
  }, [view, session.deck, previewDeck, busy])

  // Drop a selection whose block no longer exists (deleted, undone or replaced).
  useEffect(() => {
    if (selectedBlockId && !selectedBlock) setSelectedBlockId(null)
    if (editingBlockId && (!deck || !locateBlock(deck, editingBlockId))) setEditingBlockId(null)
  }, [deck, selectedBlockId, selectedBlock, editingBlockId])

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
    const onChange = () => {
      const active = document.fullscreenElement === stageWrapRef.current && Boolean(stageWrapRef.current)
      setIsFullscreen(active)
      if (!active && document.fullscreenElement === null) setMode((current) => (current === 'preview' ? modeBeforePresent.current : current))
    }
    document.addEventListener('fullscreenchange', onChange)
    return () => document.removeEventListener('fullscreenchange', onChange)
  }, [])

  // Opening the live preview starts at the slide being edited.
  useEffect(() => {
    if (mode === 'preview') setNavigation({ index: activeIndexRef.current, nonce: Date.now() })
  }, [mode])

  /* ---------- selection ---------- */

  const selectSlide = useCallback((slideId: string, blockId: string | null = null) => {
    setActiveSlideId(slideId)
    setSelectedBlockId(blockId)
    setEditingBlockId(null)
    const index = deckRef.current?.slides.findIndex((slide) => slide.id === slideId) ?? -1
    if (index >= 0) setNavigation({ index, nonce: Date.now() })
  }, [])

  const goToIndex = (index: number) => {
    if (!deck) return
    const slide = deck.slides[Math.max(0, Math.min(index, deck.slides.length - 1))]
    if (!slide) return
    followStream.current = false
    selectSlide(slide.id)
  }

  const selectBlock = (blockId: string | null) => {
    setSelectedBlockId(blockId)
    setEditingBlockId(null)
    if (blockId && inspectorTab !== 'layers') setInspectorTab('design')
  }

  /* ---------- history ---------- */

  const commitDeck = useCallback((sessionId: string, next: Deck, previous: Deck | null) => {
    if (previous && JSON.stringify(previous) !== JSON.stringify(next)) {
      const entry = historyRef.current.get(sessionId) ?? { undo: [], redo: [] }
      historyRef.current.set(sessionId, { undo: [...entry.undo, previous].slice(-HISTORY_LIMIT), redo: [] })
      setHistoryVersion((version) => version + 1)
    }
    if (sessionId === deckSessionRef.current) deckRef.current = next
    sessions.setDeck(sessionId, next)
  }, [sessions])

  const restore = useCallback((direction: 'undo' | 'redo') => {
    const entry = historyRef.current.get(session.id)
    const current = deckRef.current
    if (!entry || !current || creating) return
    const source = direction === 'undo' ? entry.undo : entry.redo
    const target = source[source.length - 1]
    if (!target) return
    historyRef.current.set(session.id, direction === 'undo'
      ? { undo: entry.undo.slice(0, -1), redo: [...entry.redo, current] }
      : { undo: [...entry.undo, current], redo: entry.redo.slice(0, -1) })
    setHistoryVersion((version) => version + 1)
    deckRef.current = target
    sessions.setDeck(session.id, target)
    setEditingBlockId(null)
  }, [session.id, creating, sessions])

  /* ---------- manual edits ---------- */

  /** Applies a UI command through the shared operation path. Returns an error message, or null. */
  const applyCommand = useCallback((command: EditorCommand | null, options: { toast?: boolean; undoToast?: boolean } = {}): string | null => {
    const base = deckRef.current
    if (!command || !base) return 'Nothing to change.'
    if (!canEdit) return 'Wait for the presentation to finish generating.'
    const result = applyOperations(base, command.operations)
    if (!result.applied.length) {
      const message = result.failed[0]?.message ?? 'Nothing changed.'
      if (options.toast) toasts.push({ kind: 'error', text: message })
      return message
    }
    commitDeck(session.id, result.deck, base)
    setDiagnostics(result.diagnostics)
    if (command.select) {
      setActiveSlideId(command.select.slideId)
      setSelectedBlockId(command.select.blockId)
      const index = result.deck.slides.findIndex((slide) => slide.id === command.select!.slideId)
      if (index >= 0) setNavigation({ index, nonce: Date.now() })
    }
    if (options.toast || options.undoToast) {
      toasts.push({ kind: 'success', text: command.summary, ...(options.undoToast ? { action: { label: 'Undo', onClick: () => restore('undo') } } : {}) })
    }
    return result.failed.length ? result.failed.map((failure) => failure.message).join(' ') : null
  }, [canEdit, commitDeck, session.id, toasts, restore])

  const applyOperationsFromUi = (operations: DeckOperation[], summary: string) => applyCommand({ operations, summary })

  const replaceDeckFromJson = (json: string): string | null => {
    let parsed: unknown
    try {
      parsed = JSON.parse(json)
    } catch (cause) {
      return `Invalid JSON: ${String(cause)}`
    }
    const result = normalizeDeck(parsed)
    if (!result.deck) return result.diagnostics.map((item) => item.message).join(' ')
    commitDeck(session.id, result.deck, deckRef.current)
    setDiagnostics(result.diagnostics)
    toasts.push({ kind: 'success', text: 'Applied the edited presentation JSON.', action: { label: 'Undo', onClick: () => restore('undo') } })
    return null
  }

  const replaceBlockJson = (blockId: string, json: string): string | null => {
    let parsed: unknown
    try {
      parsed = JSON.parse(json)
    } catch (cause) {
      return `Invalid JSON: ${String(cause)}`
    }
    return applyOperationsFromUi([{ op: 'replace_block', blockId, block: parsed }], `Edited block ${blockId}.`)
  }

  const referenceInChat = useCallback((id: string) => {
    const composer = (): ComposerHandle | null => composerRef.current
    // A collapsed chat has no composer: open it first so the insert lands.
    if (!composer()) flushSync(() => setChatCollapsed(false))
    composer()?.insertReference(id)
  }, [])

  const blockAction = (action: LayerAction, blockId: string) => {
    const current = deckRef.current
    if (!current) return
    switch (action) {
      case 'reference': referenceInChat(blockId); break
      case 'up': applyCommand(moveBlockBy(current, blockId, -1), { toast: false }); break
      case 'down': applyCommand(moveBlockBy(current, blockId, 1), { toast: false }); break
      case 'duplicate': applyCommand(duplicateBlock(current, blockId)); break
      case 'delete': applyCommand(deleteBlock(current, blockId), { undoToast: true }); break
    }
  }

  const copySelection = (cut = false): Clipboard | null => {
    const current = deckRef.current
    if (!current || !activeSlide) return null
    const block = selectedBlockId ? locateBlock(current, selectedBlockId)?.block : null
    const entry: Clipboard = block ? { kind: 'block', block: stripBlockIds(block) } : { kind: 'slide', slide: activeSlide }
    setClipboard(entry)
    if (cut && block?.id) applyCommand(deleteBlock(current, block.id), { undoToast: true })
    else toasts.push({ kind: 'info', text: block ? `Copied the ${block.type} block.` : `Copied slide ${activeIndex + 1}.` })
    return entry
  }

  const paste = (entry: Clipboard | null = clipboard) => {
    const current = deckRef.current
    if (!entry || !current || !activeSlide) return
    if (entry.kind === 'block') applyCommand(pasteBlocks(current, { slideId: activeSlide.id, blockId: selectedBlockId }, [entry.block]), { toast: true })
    else applyCommand(pasteSlide(current, entry.slide, activeSlide.id), { toast: true })
  }

  const slideAction = (action: SlideAction | 'duplicate' | 'delete' | 'reference', slideId: string) => {
    const current = deckRef.current
    if (!current) return
    switch (action) {
      case 'reference': referenceInChat(slideId); break
      case 'duplicate': applyCommand(duplicateSlide(current, slideId), { toast: true }); break
      case 'delete': applyCommand(deleteSlide(current, slideId), { undoToast: true }); break
      case 'move-back': applyCommand(moveSlideBy(current, slideId, -1)); break
      case 'move-forward': applyCommand(moveSlideBy(current, slideId, 1)); break
      case 'copy': {
        const found = findSlide(current, slideId)
        if (found) {
          setClipboard({ kind: 'slide', slide: found.slide })
          toasts.push({ kind: 'info', text: `Copied slide ${found.index + 1}.` })
        }
        break
      }
      case 'paste': if (clipboard) {
        if (clipboard.kind === 'slide') applyCommand(pasteSlide(current, clipboard.slide, slideId), { toast: true })
        else applyCommand(pasteBlocks(current, { slideId }, [clipboard.block]), { toast: true })
      } break
    }
  }

  const addSlideFromStarter = (starterId: string, after: string | null) => {
    const current = deckRef.current
    const starter = getSlideStarter(starterId)
    if (!current || !starter) return
    const command = addSlide(current, starter.build() as Omit<Slide, 'id'>, after ?? undefined, `Added a ${starter.label.toLowerCase()} slide.`)
    if (!applyCommand(command) && command.select) {
      setSelectedBlockId(null)
      setMode('edit')
    }
  }

  const insertBlock = (type: string) => {
    const current = deckRef.current
    if (!current || !activeSlide) return
    const error = applyCommand(insertPrimitive(current, { slideId: activeSlide.id, blockId: selectedBlockId }, type))
    if (error) toasts.push({ kind: 'error', text: error })
    else setInspectorTab('design')
  }

  const insertPlacement = (() => {
    if (!deck || !activeSlide) return 'on this slide'
    const point = insertionPoint(deck, { slideId: activeSlide.id, blockId: selectedBlockId })
    if (point.parentId && point.index === undefined) return `inside the selected ${locateBlock(deck, point.parentId)?.block.type ?? 'container'}`
    if (selectedBlock) return `after the selected ${selectedBlock.type}`
    return 'at the end of the slide'
  })()

  /* ---------- agent ---------- */

  const runGeneration = async (prompt: string, options: SendOptions = { includeSelection: true }) => {
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
    const baseDeck = deckRef.current
    const historyTurns: ChatTurn[] = session.messages
      .filter((message): message is ChatMessage & { role: 'user' | 'assistant' } => message.role === 'user' || message.role === 'assistant')
      .map((message) => ({ role: message.role, content: message.text }))
    const references = baseDeck ? resolveMentions(baseDeck, prompt).resolved : []
    setHomeError(null)
    sessions.renameFromPrompt(sessionId, prompt.split('\n\nPresentation preferences:')[0])
    sessions.appendMessages(sessionId, [createMessage('user', prompt, undefined, { references: references.map(snapshotReference) })])
    const controller = new AbortController()
    controllerRef.current = controller
    followStream.current = true
    setProgress({ phase: 'sending', startedAt: Date.now() })
    setDiagnostics([])
    setAgentTurn(null)

    const result = await generate({
      prompt,
      config,
      deck: baseDeck,
      history: historyTurns,
      focusedSlideId: baseDeck && options.includeSelection ? activeSlide?.id : null,
      selectedBlockId: baseDeck && options.includeSelection ? selectedBlock?.id ?? null : null,
      fitScales: baseDeck ? fitScales : undefined,
      resolveDeck: () => (deckSessionRef.current === sessionId ? deckRef.current : baseDeck),
      signal: controller.signal,
      onPhase: (phase, detail) => setProgress((current) => ({ phase, detail, startedAt: current?.startedAt ?? Date.now() })),
      onPreview: (partial) => {
        if (baseDeck) return
        setPreviewDeck(partial)
        setView('studio')
        if (followStream.current) setActiveSlideId(partial.slides[partial.slides.length - 1]?.id ?? null)
      },
    })

    controllerRef.current = null
    setProgress(null)
    setPreviewDeck(null)

    if (result.ok && result.kind === 'deck') {
      const before = result.base ?? baseDeck
      commitDeck(sessionId, result.deck, before)
      setDiagnostics(result.diagnostics)
      const changes = diffDecks(before, result.deck)
      const warnings = summarizeDiagnostics(result.diagnostics)
      const summary = result.message ?? (result.created
        ? `Created “${deckTitle(result.deck)}” with ${result.deck.slides.length} slides.`
        : `Applied ${result.appliedOperations} change${result.appliedOperations === 1 ? '' : 's'}.`)
      const assistant = createMessage('assistant', summary, undefined, result.created ? {} : { changes: { added: changes.added.slice(0, 60), changed: changes.changed.slice(0, 60), removed: changes.removed.length } })
      const messages = [assistant]
      if (result.failedOperations.length) {
        messages.push(createMessage('error', `${result.failedOperations.length} requested change${result.failedOperations.length === 1 ? ' was' : 's were'} skipped.`, result.failedOperations.map((failure) => failure.message)))
      }
      if (warnings.length) messages.push(createMessage('status', 'Some generated content was adjusted to fit the renderer.', warnings))
      sessions.appendMessages(sessionId, messages)
      if (before && !result.created) setAgentTurn({ sessionId, messageId: assistant.id, before, after: result.deck })
      if (result.created) {
        selectSlide(result.deck.slides[0].id)
      } else if (changes.changed.length + changes.added.length === 1) {
        // One slide changed: show it.
        const target = changes.added[0] ?? changes.changed[0]
        if (target !== activeSlide?.id) selectSlide(target)
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
      sessions.appendMessages(sessionId, [createMessage('status', 'Stopped. Nothing was changed.')])
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

  const revertableMessageId = agentTurn && agentTurn.sessionId === session.id && session.deck === agentTurn.after ? agentTurn.messageId : null
  const revertTurn = () => {
    if (!agentTurn || !revertableMessageId) return
    commitDeck(session.id, agentTurn.before, deckRef.current)
    setAgentTurn(null)
    sessions.appendMessages(session.id, [createMessage('status', 'Reverted the assistant’s change.')])
  }

  /* ---------- sessions ---------- */

  const resetEditor = () => {
    setSelectedBlockId(null)
    setEditingBlockId(null)
    setActiveSlideId(null)
    setNavigation(null)
    setDiagnostics([])
    setAgentTurn(null)
    setMode('edit')
  }

  const startFromDeck = (raw: unknown, label: string) => {
    const result = normalizeDeck(raw)
    if (!result.deck) {
      setHomeError(`${label} could not be opened: ${result.diagnostics.map((item) => item.message).join(' ')}`)
      return
    }
    const id = sessions.createAndSelect(result.deck)
    sessions.appendMessages(id, [createMessage('status', `Opened ${label}.`, summarizeDiagnostics(result.diagnostics))])
    resetEditor()
    setDiagnostics(result.diagnostics)
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
  const startBlank = () => startFromDeck({ title: 'Untitled presentation', theme: { preset: 'midnight' }, slides: [{ ...getSlideStarter('title')!.build(), id: 'title' }] }, 'a blank presentation')

  const newPresentation = () => {
    if (busy) return
    sessions.createAndSelect(null)
    resetEditor()
    setView('home')
  }

  const openSession = (id: string) => {
    if (busy) return
    sessions.select(id)
    resetEditor()
    setView('studio')
  }

  /* ---------- export and present ---------- */

  const exportJson = () => {
    if (!session.deck) return
    downloadFile(JSON.stringify(session.deck, null, 2), deckFileName(session.deck, 'json'), 'application/json')
    toasts.push({ kind: 'success', text: `Downloaded ${deckFileName(session.deck, 'json')}.` })
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
      toasts.push({ kind: 'success', text: parts.join(' ') })
    } catch {
      toasts.push({ kind: 'error', text: 'The presentation could not be exported. Export JSON to keep your work.' })
    } finally {
      setExporting(false)
    }
  }

  const present = async () => {
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen()
        return
      }
      // Mount the Reveal viewer synchronously so requestFullscreen still runs inside the user activation.
      if (mode !== 'preview') modeBeforePresent.current = mode
      flushSync(() => setMode('preview'))
      await stageWrapRef.current?.requestFullscreen()
      stageWrapRef.current?.querySelector<HTMLElement>('.v2-stage')?.focus()
    } catch {
      toasts.push({ kind: 'error', text: 'Fullscreen is not available here; the preview shows the live slides instead.' })
    }
  }

  /* ---------- keyboard, clipboard ---------- */

  const handlers = useRef({ restore, copySelection, paste, present, applyCommand, referenceInChat, goToIndex, blockAction, slideAction, addSlideFromStarter })
  handlers.current = { restore, copySelection, paste, present, applyCommand, referenceInChat, goToIndex, blockAction, slideAction, addSlideFromStarter }
  const stateRef = useRef({ view, mode, activeSlide, activeIndex, selectedBlock, located, canEdit, editingBlockId })
  stateRef.current = { view, mode, activeSlide, activeIndex, selectedBlock, located, canEdit, editingBlockId }

  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      const state = stateRef.current
      const actions = handlers.current
      if (state.view !== 'studio' || event.defaultPrevented || event.isComposing) return
      if (isTypingTarget(event.target)) return
      const mod = event.metaKey || event.ctrlKey
      const key = event.key.toLowerCase()
      if (mod && key === 'z') { event.preventDefault(); actions.restore(event.shiftKey ? 'redo' : 'undo'); return }
      if (mod && key === 'y') { event.preventDefault(); actions.restore('redo'); return }
      if (isWidgetTarget(event.target)) return
      const block = state.selectedBlock
      const slide = state.activeSlide
      const deckNow = deckRef.current
      if (!slide || !deckNow) return
      if (event.key === '?' || (event.shiftKey && event.key === '/')) { event.preventDefault(); setShortcutsOpen(true); return }
      if ((mod && key === 'enter') || (!mod && !event.altKey && key === 'p')) { event.preventDefault(); void actions.present(); return }
      if ((mod && key === 'j') || event.key === '@') { event.preventDefault(); actions.referenceInChat(block?.id ?? slide.id); return }
      if (state.mode === 'preview') return
      if (event.key === '/' && state.canEdit) { event.preventDefault(); setMode('edit'); setInsertOpen(true); return }
      if (mod && key === 'm' && state.canEdit) { event.preventDefault(); actions.addSlideFromStarter('content', slide.id); return }
      if (mod && key === 'd' && state.canEdit) {
        event.preventDefault()
        if (block?.id) actions.blockAction('duplicate', block.id)
        else actions.slideAction('duplicate', slide.id)
        return
      }
      if (block?.id) {
        if ((event.key === 'Delete' || event.key === 'Backspace') && state.canEdit) { event.preventDefault(); actions.blockAction('delete', block.id); return }
        if ((event.altKey || mod) && (event.key === 'ArrowUp' || event.key === 'ArrowDown') && state.canEdit) { event.preventDefault(); actions.blockAction(event.key === 'ArrowUp' ? 'up' : 'down', block.id); return }
        if (event.key === 'Enter' && !event.shiftKey && state.canEdit && supportsInlineEdit(block.type)) { event.preventDefault(); setEditingBlockId(block.id); return }
        if (event.key === 'Escape' || (event.key === 'Enter' && event.shiftKey)) {
          event.preventDefault()
          const parent = state.located?.parent
          setSelectedBlockId(parent?.id ?? null)
          return
        }
      }
      if (state.mode === 'grid' && event.key === 'Escape') { setMode('edit'); return }
      if (!block && (event.key === 'ArrowRight' || event.key === 'PageDown')) { event.preventDefault(); actions.goToIndex(state.activeIndex + 1); return }
      if (!block && (event.key === 'ArrowLeft' || event.key === 'PageUp')) { event.preventDefault(); actions.goToIndex(state.activeIndex - 1) }
    }
    const onCopy = (event: ClipboardEvent) => {
      if (stateRef.current.view !== 'studio' || isTypingTarget(event.target) || window.getSelection()?.toString()) return
      const entry = handlers.current.copySelection(event.type === 'cut' && stateRef.current.canEdit)
      if (!entry) return
      event.preventDefault()
      event.clipboardData?.setData('text/plain', JSON.stringify({ app: CLIPBOARD_TAG, ...entry }))
    }
    const onPaste = (event: ClipboardEvent) => {
      if (stateRef.current.view !== 'studio' || !stateRef.current.canEdit || isTypingTarget(event.target)) return
      const entry = parseClipboard(event.clipboardData?.getData('text/plain') ?? '')
      if (!entry) return
      event.preventDefault()
      setClipboard(entry)
      handlers.current.paste(entry)
    }
    window.addEventListener('keydown', onKeyDown)
    document.addEventListener('copy', onCopy)
    document.addEventListener('cut', onCopy)
    document.addEventListener('paste', onPaste)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      document.removeEventListener('copy', onCopy)
      document.removeEventListener('cut', onCopy)
      document.removeEventListener('paste', onPaste)
    }
  }, [])

  /* ---------- views ---------- */

  if (view === 'gallery') return <PrimitiveGallery onClose={() => setView(session.deck ? 'studio' : 'home')} />

  if (view === 'home' || !deck || !activeSlide) {
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
          onBlank={startBlank}
        />
        {busy && <div className="v2-home__progress" role="status">{progress?.phase === 'thinking' ? 'Researching and designing…' : 'Composing your presentation…'} <button type="button" className="v2-link" onClick={cancel}>Cancel</button></div>}
      </div>
    )
  }

  const selectedLocated = selectedBlock ? located : null
  const blockToolbar = selectedBlock && selectedBlock.id && mode === 'edit' ? (
    <div className="v2-seltools" role="toolbar" aria-label={`${selectedBlock.type} actions`}>
      <span className="v2-seltools__type"><Icon name={primitiveIcons[selectedBlock.type] ?? 'square'} size={13} />{selectedBlock.type}</span>
      {supportsInlineEdit(selectedBlock.type) && <button type="button" className="v2-seltools__button" title="Edit text (Enter)" aria-label="Edit text" disabled={!canEdit} onClick={() => setEditingBlockId(selectedBlock.id!)}><Icon name="edit" size={14} /></button>}
      {selectedLocated?.parent && <button type="button" className="v2-seltools__button" title="Select parent (Esc)" aria-label="Select parent" onClick={() => setSelectedBlockId(selectedLocated.parent?.id ?? null)}><Icon name="corner-left-up" size={14} /></button>}
      <button type="button" className="v2-seltools__button" title={`Move up (Alt+↑)`} aria-label="Move up" disabled={!canEdit} onClick={() => blockAction('up', selectedBlock.id!)}><Icon name="arrow-up" size={14} /></button>
      <button type="button" className="v2-seltools__button" title={`Move down (Alt+↓)`} aria-label="Move down" disabled={!canEdit} onClick={() => blockAction('down', selectedBlock.id!)}><Icon name="arrow-down" size={14} /></button>
      <button type="button" className="v2-seltools__button" title={`Duplicate (${MOD}+D)`} aria-label="Duplicate" disabled={!canEdit} onClick={() => blockAction('duplicate', selectedBlock.id!)}><Icon name="duplicate" size={14} /></button>
      <button type="button" className="v2-seltools__button v2-seltools__button--ai" title={`Ask AI about this element (@ or ${MOD}+J)`} aria-label="Ask AI about this element" onClick={() => referenceInChat(selectedBlock.id!)}><Icon name="at-sign" size={14} /><span>Ask AI</span></button>
      <button type="button" className="v2-seltools__button v2-seltools__button--danger" title="Delete (Del)" aria-label="Delete" disabled={!canEdit} onClick={() => blockAction('delete', selectedBlock.id!)}><Icon name="trash" size={14} /></button>
    </div>
  ) : null

  const themeItems: MenuItem[] = themePresetNames.map((name) => ({
    id: name,
    label: `${name}${name === theme.preset ? ' ✓' : ''}`,
    icon: 'palette',
    disabled: !canEdit,
    onSelect: () => applyCommand(setDeckProps({ theme: { preset: name } }, `Switched to the ${name} theme.`), { toast: true }),
  }))
  themeItems.push({ id: 'more', label: 'Fonts, colors and settings…', icon: 'settings', separatorBefore: true, onSelect: () => { setShowInspector(true); setInspectorTab('theme') } })

  const exportItems: MenuItem[] = [
    { id: 'html', label: exporting ? 'Exporting…' : 'Export HTML (self-contained)', icon: 'download', disabled: !session.deck || exporting, onSelect: () => void exportHtml() },
    { id: 'json', label: 'Download JSON', icon: 'braces', disabled: !session.deck, onSelect: exportJson },
  ]
  const moreItems: MenuItem[] = [
    { id: 'new', label: 'New presentation', icon: 'plus', disabled: busy, onSelect: newPresentation },
    { id: 'shortcuts', label: 'Keyboard shortcuts', icon: 'keyboard', shortcut: '?', onSelect: () => setShortcutsOpen(true) },
    { id: 'gallery', label: 'Primitive gallery', icon: 'shapes', separatorBefore: true, onSelect: () => setView('gallery') },
    { id: 'v1', label: 'Classic v1 studio', icon: 'home', onSelect: () => { window.location.href = './v1/' } },
  ]

  const saveLabel = sessions.saveState === 'saving' ? 'Saving…' : sessions.saveState === 'error' ? 'Not saved' : 'Saved'
  const fitScale = fitScales[activeSlide.id]

  const commitTitle = () => {
    if (titleDraft === null) return
    const next = titleDraft.trim()
    setTitleDraft(null)
    if (next && next !== deckTitle(deck)) applyCommand(setDeckProps({ title: next }, 'Renamed the presentation.'))
  }

  return (
    <div className={`v2-app v2-app--studio${showInspector ? '' : ' v2-app--no-inspector'}${chatCollapsed ? ' v2-app--chat-collapsed' : ''}`}>
      <header className="v2-topbar">
        <a className="v2-brand" href="./" onClick={(event) => { event.preventDefault(); if (!busy) setView('home') }} title="Home"><span className="v2-brand__mark">M</span><span className="v2-brand__name">Magic Slider</span></a>
        <div className="v2-topbar__title">
          <label className="v2-visually-hidden" htmlFor="v2-deck-title">Presentation title</label>
          <input
            id="v2-deck-title"
            className="v2-title-input"
            value={titleDraft ?? deckTitle(deck)}
            disabled={!canEdit}
            onFocus={() => setTitleDraft(deckTitle(deck))}
            onChange={(event) => setTitleDraft(event.target.value)}
            onBlur={commitTitle}
            onKeyDown={(event) => {
              if (event.key === 'Enter') event.currentTarget.blur()
              if (event.key === 'Escape') { setTitleDraft(null); event.currentTarget.blur() }
            }}
          />
          <span className="v2-muted v2-topbar__meta">{deck.slides.length} slides · {theme.preset}</span>
          <span className={`v2-save v2-save--${sessions.saveState}`} role="status" title={sessions.persistenceError ?? 'Saved in this browser'}>
            <Icon name={sessions.saveState === 'error' ? 'warning' : sessions.saveState === 'saving' ? 'loader' : 'check'} size={13} />{saveLabel}
          </span>
        </div>
        <div className="v2-seg v2-modes" role="radiogroup" aria-label="View">
          {([['edit', 'Edit', 'edit'], ['preview', 'Preview', 'eye'], ['grid', 'Grid', 'layout-grid']] as const).map(([id, label, icon]) => (
            <button key={id} type="button" role="radio" aria-checked={mode === id} className="v2-seg__option" onClick={() => setMode(id)}><Icon name={icon} size={14} />{label}</button>
          ))}
        </div>
        <div className="v2-toolbar" role="toolbar" aria-label="Presentation actions">
          <button type="button" className="v2-icon-button" aria-label="Undo" title={`Undo (${MOD}+Z)`} disabled={!history?.undo.length || creating} onClick={() => restore('undo')}><Icon name="undo" /></button>
          <button type="button" className="v2-icon-button" aria-label="Redo" title={`Redo (${MOD}+Shift+Z)`} disabled={!history?.redo.length || creating} onClick={() => restore('redo')}><Icon name="redo" /></button>
          <MenuButton label="Theme" items={themeItems} className="v2-button v2-button--ghost" title="Theme"><Icon name="palette" size={15} /><span className="v2-hide-sm">Theme</span></MenuButton>
          <MenuButton label="Export" items={exportItems} className="v2-button v2-button--ghost" title="Export"><Icon name="download" size={15} /><span className="v2-hide-sm">Export</span></MenuButton>
          {document.fullscreenEnabled && <button type="button" className="v2-button v2-button--primary" onClick={() => void present()} title="Present (P)"><Icon name="play" size={15} />{isFullscreen ? 'Exit' : 'Present'}</button>}
          <button type="button" className="v2-icon-button" aria-pressed={showInspector} aria-label={showInspector ? 'Hide the inspector' : 'Show the inspector'} title="Inspector" onClick={() => setShowInspector((open) => !open)}><Icon name={showInspector ? 'panel-right-close' : 'panel-right-open'} /></button>
          <MenuButton label="More" items={moreItems}><Icon name="more" /></MenuButton>
        </div>
      </header>
      {sessions.persistenceError && <p className="v2-alert v2-alert--banner" role="alert">{sessions.persistenceError}</p>}

      <div className="v2-workspace">
        <ChatPanel
          composerRef={composerRef}
          deck={session.deck}
          messages={session.messages}
          progress={progress}
          activeSlideId={activeSlide.id}
          selection={selection}
          revertableMessageId={revertableMessageId}
          collapsed={chatCollapsed}
          onToggleCollapsed={() => setChatCollapsed((value) => !value)}
          onSend={(prompt, options) => void runGeneration(prompt, options)}
          onCancel={cancel}
          onNavigate={(target) => {
            selectSlide(target.slideId, target.kind === 'block' ? target.id : null)
            if (mode === 'grid') setMode('edit')
          }}
          onRevert={revertTurn}
        />
        <main className="v2-canvas" id="main" aria-label="Presentation">
          {mode === 'edit' && (
            <div className="v2-canvas__bar" role="toolbar" aria-label="Slide tools">
              <button ref={insertButtonRef} type="button" className="v2-button v2-button--ghost v2-button--sm" disabled={!canEdit} aria-haspopup="dialog" aria-expanded={insertOpen} onClick={() => setInsertOpen((open) => !open)} title="Insert a block (/)"><Icon name="plus" size={15} />Insert</button>
              <span className="v2-canvas__where">Slide {activeIndex + 1} of {deck.slides.length}{activeSlide.name ? ` · ${activeSlide.name}` : ''}</span>
              {fitScale !== undefined && fitScale < 0.9 && <span className="v2-rail__fit" title="Content was scaled down to fit the canvas">Scaled to {Math.round(fitScale * 100)}%</span>}
              <span className="v2-canvas__spacer" />
              <button type="button" className="v2-button v2-button--ghost v2-button--sm" onClick={() => referenceInChat(activeSlide.id)} title="Reference this slide in chat"><Icon name="at-sign" size={14} /><span className="v2-hide-sm">Ask AI about this slide</span><span className="v2-show-sm">Ask AI</span></button>
            </div>
          )}
          {mode === 'grid' && (
            <SlideOverview deck={deck} theme={theme} fitScales={fitScales} activeIndex={activeIndex} onOpen={(index) => { setMode('edit'); goToIndex(index) }} />
          )}
          {mode === 'edit' && (
            <EditCanvas
              deck={deck}
              slide={activeSlide}
              theme={theme}
              fitScale={fitScale}
              selectedBlockId={selectedBlock?.id ?? null}
              editingBlockId={editingBlockId}
              readOnly={!canEdit}
              onSelect={selectBlock}
              onRequestEdit={(blockId) => { if (canEdit) setEditingBlockId(blockId) }}
              onCommitEdit={(blockId, set) => {
                const error = applyCommand(setBlockProps(deckRef.current!, blockId, set))
                if (error) toasts.push({ kind: 'error', text: error })
              }}
              onEditError={(message) => toasts.push({ kind: 'error', text: message })}
              onEndEdit={() => setEditingBlockId(null)}
              onInsert={() => setInsertOpen(true)}
              toolbar={blockToolbar}
            />
          )}
          <div className="v2-canvas__stage" ref={stageWrapRef} hidden={mode !== 'preview'}>
            {mode === 'preview' && (
              <DeckStage
                deck={deck}
                fitScales={fitScales}
                navigation={navigation}
                selectedBlockId={selectedBlock?.id ?? null}
                building={Boolean(previewDeck)}
                onSlideChange={(index) => { const slide = deck.slides[index]; if (slide) setActiveSlideId(slide.id) }}
                onBlockSelect={(blockId) => selectBlock(blockId)}
                onError={(message) => toasts.push({ kind: 'error', text: message })}
              />
            )}
          </div>
          {previewDeck && <p className="v2-canvas__building" role="status"><Icon name="loader" size={13} className="v2-spin" />Building live · {previewDeck.slides.length} slide{previewDeck.slides.length === 1 ? '' : 's'} ready</p>}
          {busy && session.deck && <p className="v2-canvas__working" role="status"><Icon name="sparkles" size={13} />The assistant is working. You can keep editing; its changes apply on top.</p>}
          {mode !== 'grid' && (
            <SlideRail
              deck={deck}
              theme={theme}
              fitScales={fitScales}
              activeIndex={activeIndex}
              disabled={!canEdit}
              canPaste={Boolean(clipboard)}
              onSelect={goToIndex}
              onMoveTo={(slideId, target) => { const current = deckRef.current; if (current) applyCommand(moveSlideTo(current, slideId, target)) }}
              onAction={slideAction}
              onAddSlide={addSlideFromStarter}
            />
          )}
        </main>
        {showInspector && (
          <Inspector
            deck={deck}
            slide={activeSlide}
            slideIndex={activeIndex}
            selectedBlockId={selectedBlock?.id ?? null}
            diagnostics={diagnostics}
            fitScale={fitScale}
            disabled={!canEdit}
            tab={inspectorTab}
            onTabChange={setInspectorTab}
            onSelectBlock={(id) => selectBlock(id)}
            onSetBlock={(blockId, set) => applyCommand(setBlockProps(deckRef.current!, blockId, set))}
            onSetSlide={(slideId, set) => applyCommand(setSlideProps(deckRef.current!, slideId, set))}
            onSetDeck={(set, summary) => applyCommand(setDeckProps(set, summary))}
            onBlockAction={blockAction}
            onSlideAction={slideAction}
            onReplaceBlockJson={replaceBlockJson}
            onReplaceDeck={replaceDeckFromJson}
          />
        )}
      </div>
      <InsertMenu anchorRef={insertButtonRef} open={insertOpen && mode === 'edit'} placementLabel={insertPlacement} onInsert={insertBlock} onClose={() => setInsertOpen(false)} />
      <ShortcutsDialog open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />
      <ToastRegion toasts={toasts.toasts} onDismiss={toasts.dismiss} />
    </div>
  )
}
