import { useEffect, useRef, useState, type ReactNode, type Ref } from 'react'

import type { GenerationPhase } from '../../agent/agentClient'
import { mentionRanges, resolveReference, slideLabel, type ReferenceSnapshot, type ResolvedReference } from '../../agent/references'
import type { Deck } from '../../domain/deckSchema'
import { findSlide } from '../../domain/tree'
import type { ChatMessage } from '../../session/sessions'
import Icon, { primitiveIcons } from '../common/Icon'
import Composer, { type ComposerHandle, type SendOptions } from './Composer'

export interface GenerationProgress {
  phase: GenerationPhase
  detail?: string
  startedAt: number
}

type NavigateTarget = Pick<ResolvedReference, 'id' | 'kind' | 'slideId'>

interface ChatPanelProps {
  composerRef?: Ref<ComposerHandle>
  deck: Deck | null
  messages: ChatMessage[]
  progress: GenerationProgress | null
  activeSlideId: string | null
  selection: ResolvedReference | null
  /** The assistant message whose change can still be reverted in one step. */
  revertableMessageId?: string | null
  disabled?: boolean
  collapsed?: boolean
  onToggleCollapsed?: () => void
  onSend: (prompt: string, options: SendOptions) => void
  onCancel: () => void
  onNavigate: (target: NavigateTarget) => void
  onRevert?: (messageId: string) => void
}

const phaseCopy: Record<GenerationPhase, string> = {
  sending: 'Sending your request…',
  thinking: 'Researching facts and preparing visuals…',
  writing: 'Composing slides…',
  building: 'Building slides…',
  validating: 'Validating and rendering…',
}

const quickActions = [
  { label: 'More visual', prompt: 'Make this slide more visual: turn text into stats, a chart or a diagram where it fits.', scoped: true },
  { label: 'Tighten', prompt: 'Tighten the wording on this slide: a sharper takeaway title and fewer, shorter points.', scoped: true },
  { label: 'Add a chart', prompt: 'Add a chart with sourced data that supports the main claim of this slide.', scoped: true },
  { label: 'Speaker notes', prompt: 'Write clear speaker notes for every slide, with transitions between slides.' },
  { label: 'Cite sources', prompt: 'Research and attach sources to every slide that states facts or figures, and correct anything the sources contradict.' },
  { label: 'Restyle', prompt: 'Give the deck a fresh, bolder visual direction: new theme, fonts and more varied slide compositions. Keep the content.' },
]

function elapsed(startedAt: number, now: number): string {
  const seconds = Math.max(0, Math.floor((now - startedAt) / 1000))
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
}

/** A reference in a sent message: resolved live, so it navigates, or shows that it was deleted. */
function SentReference({ id, snapshot, deck, onNavigate }: { id: string; snapshot?: ReferenceSnapshot; deck: Deck | null; onNavigate: (target: NavigateTarget) => void }) {
  const live = deck ? resolveReference(deck, id) : null
  if (!live && !snapshot) return <>@{id}</>
  if (!live) {
    return (
      <span className="v2-inlineref v2-inlineref--deleted" title={`@${id} was deleted after this message`}>
        <Icon name={primitiveIcons[snapshot!.type] ?? 'square'} size={12} />{snapshot!.label}
      </span>
    )
  }
  return (
    <button type="button" className={`v2-inlineref v2-inlineref--${live.kind}`} title={`Show @${id}`} onClick={() => onNavigate(live)}>
      <Icon name={primitiveIcons[live.type] ?? 'square'} size={12} />{live.label}
    </button>
  )
}

function MessageText({ message, deck, onNavigate }: { message: ChatMessage; deck: Deck | null; onNavigate: (target: NavigateTarget) => void }) {
  if (message.role !== 'user') return <p>{message.text}</p>
  const snapshots = new Map((message.references ?? []).map((reference) => [reference.id, reference]))
  const parts: ReactNode[] = []
  let cursor = 0
  for (const range of mentionRanges(message.text)) {
    const snapshot = snapshots.get(range.id)
    if (!snapshot && !(deck && resolveReference(deck, range.id))) continue
    parts.push(message.text.slice(cursor, range.start))
    parts.push(<SentReference key={range.start} id={range.id} snapshot={snapshot} deck={deck} onNavigate={onNavigate} />)
    cursor = range.end
  }
  parts.push(message.text.slice(cursor))
  return <p>{parts}</p>
}

function ChangeLinks({ message, deck, onNavigate }: { message: ChatMessage; deck: Deck | null; onNavigate: (target: NavigateTarget) => void }) {
  const changes = message.changes
  if (!changes || !deck) return null
  const link = (slideId: string, prefix: string) => {
    const found = findSlide(deck, slideId)
    if (!found) return null
    return (
      <button key={`${prefix}-${slideId}`} type="button" className="v2-inlineref v2-inlineref--slide" onClick={() => onNavigate({ id: slideId, kind: 'slide', slideId })}>
        {prefix === 'added' && <Icon name="plus" size={11} />}{slideLabel(found.slide, found.index)}
      </button>
    )
  }
  const added = changes.added.map((id) => link(id, 'added')).filter(Boolean)
  const changed = changes.changed.map((id) => link(id, 'changed')).filter(Boolean)
  if (!added.length && !changed.length && !changes.removed) return null
  return (
    <div className="v2-message__changes">
      {changed.length > 0 && <span className="v2-message__changes-label">Changed</span>}
      {changed}
      {added.length > 0 && <span className="v2-message__changes-label">Added</span>}
      {added}
      {changes.removed > 0 && <span className="v2-message__changes-label">Removed {changes.removed} slide{changes.removed === 1 ? '' : 's'}</span>}
    </div>
  )
}

export default function ChatPanel({
  composerRef, deck, messages, progress, activeSlideId, selection, revertableMessageId, disabled, collapsed, onToggleCollapsed, onSend, onCancel, onNavigate, onRevert,
}: ChatPanelProps) {
  const [now, setNow] = useState(() => Date.now())
  const historyRef = useRef<HTMLDivElement>(null)
  const busy = Boolean(progress)

  useEffect(() => {
    if (!progress) return undefined
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [progress])

  useEffect(() => {
    const history = historyRef.current
    if (history) history.scrollTop = history.scrollHeight
  }, [messages.length, progress?.phase, collapsed])

  if (collapsed) {
    return (
      <section className="v2-chat v2-chat--collapsed" aria-label="Conversation">
        <button type="button" className="v2-icon-button" aria-label="Open the chat" title="Open the chat" onClick={onToggleCollapsed}><Icon name="panel-left-open" /></button>
        {busy && <span className="v2-progress__pulse" aria-label="The assistant is working" />}
      </section>
    )
  }

  const scoped = Boolean(activeSlideId)
  return (
    <section className="v2-chat" aria-label="Conversation">
      <header className="v2-panel-header">
        <h2><Icon name="sparkles" size={15} />Assistant</h2>
        {onToggleCollapsed && <button type="button" className="v2-icon-button v2-icon-button--sm" aria-label="Collapse the chat" title="Collapse the chat" onClick={onToggleCollapsed}><Icon name="panel-left-close" /></button>}
      </header>
      <div className="v2-chat__history" ref={historyRef} aria-live="polite">
        {messages.length === 0 && (
          <div className="v2-chat__empty">
            <p><strong>Ask for any change.</strong> The assistant sees the whole deck and the slide you are viewing.</p>
            <p>Type <kbd>@</kbd> to point at a slide or element, e.g. “replace @cover-image with a sunrise and tighten @market-size”. You can also drag slides here, or press <kbd>@</kbd> with an element selected.</p>
          </div>
        )}
        {messages.map((message) => (
          <article key={message.id} className={`v2-message v2-message--${message.role}`}>
            {(message.role === 'user' || message.role === 'assistant') && <span className="v2-message__author">{message.role === 'user' ? 'You' : 'Magic Slider'}</span>}
            <MessageText message={message} deck={deck} onNavigate={onNavigate} />
            <ChangeLinks message={message} deck={deck} onNavigate={onNavigate} />
            {message.details && message.details.length > 0 && (
              <details className="v2-message__details">
                <summary>{message.details.length} detail{message.details.length === 1 ? '' : 's'}</summary>
                <ul>{message.details.map((detail, index) => <li key={index}>{detail}</li>)}</ul>
              </details>
            )}
            {revertableMessageId === message.id && onRevert && !busy && (
              <button type="button" className="v2-link v2-message__revert" onClick={() => onRevert(message.id)}><Icon name="undo" size={13} />Revert this change</button>
            )}
          </article>
        ))}
        {progress && (
          <div className="v2-progress" role="status">
            <span className="v2-progress__pulse" aria-hidden="true" />
            <span>{phaseCopy[progress.phase]}{progress.detail ? ` ${progress.detail}` : ''}</span>
            <span className="v2-progress__time" aria-hidden="true">{elapsed(progress.startedAt, now)}</span>
          </div>
        )}
      </div>
      <Composer
        ref={composerRef}
        deck={deck}
        activeSlideId={activeSlideId}
        selection={selection}
        busy={busy}
        disabled={disabled}
        onSend={onSend}
        onCancel={onCancel}
        onNavigate={onNavigate}
        quickActions={!busy && (
          <div className="v2-chips" role="group" aria-label="Suggested changes">
            {quickActions.filter((action) => !action.scoped || scoped).map((action) => (
              <button key={action.label} type="button" className="v2-chip" disabled={disabled} onClick={() => onSend(action.prompt, { includeSelection: false })}>{action.label}</button>
            ))}
          </div>
        )}
      />
    </section>
  )
}
