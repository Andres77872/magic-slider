import { useEffect, useRef, useState, type KeyboardEvent } from 'react'

import type { ChatMessage } from '../session/sessions'
import type { GenerationPhase } from '../agent/agentClient'

export interface GenerationProgress {
  phase: GenerationPhase
  detail?: string
  startedAt: number
}

interface ChatPanelProps {
  messages: ChatMessage[]
  progress: GenerationProgress | null
  focusedSlideLabel?: string
  selectedBlockLabel?: string
  disabled?: boolean
  onSend: (prompt: string) => void
  onCancel: () => void
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

export default function ChatPanel({ messages, progress, focusedSlideLabel, selectedBlockLabel, disabled, onSend, onCancel }: ChatPanelProps) {
  const [prompt, setPrompt] = useState('')
  const [now, setNow] = useState(() => Date.now())
  const historyRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const busy = Boolean(progress)

  useEffect(() => {
    if (!progress) return undefined
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [progress])

  useEffect(() => {
    const history = historyRef.current
    if (history) history.scrollTop = history.scrollHeight
  }, [messages.length, progress?.phase])

  const send = (text = prompt) => {
    const trimmed = text.trim()
    if (!trimmed || busy || disabled) return
    onSend(trimmed)
    setPrompt('')
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault()
      send()
    }
  }

  return (
    <section className="v2-chat" aria-label="Conversation">
      <div className="v2-chat__history" ref={historyRef} aria-live="polite">
        {messages.length === 0 && (
          <div className="v2-chat__empty">
            <p>Ask for any change. Refer to slides by number or name; with a slide selected, “this slide” means it.</p>
          </div>
        )}
        {messages.map((message) => (
          <article key={message.id} className={`v2-message v2-message--${message.role}`}>
            {(message.role === 'user' || message.role === 'assistant') && <span className="v2-message__author">{message.role === 'user' ? 'You' : 'Magic Slider'}</span>}
            <p>{message.text}</p>
            {message.details && message.details.length > 0 && (
              <details className="v2-message__details">
                <summary>{message.details.length} detail{message.details.length === 1 ? '' : 's'}</summary>
                <ul>{message.details.map((detail, index) => <li key={index}>{detail}</li>)}</ul>
              </details>
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

      <div className="v2-chat__composer">
        {!busy && (
          <div className="v2-chips" role="group" aria-label="Suggested changes">
            {quickActions.filter((action) => !action.scoped || focusedSlideLabel).map((action) => (
              <button key={action.label} type="button" className="v2-chip" disabled={disabled} onClick={() => send(action.prompt)}>{action.label}</button>
            ))}
          </div>
        )}
        {(focusedSlideLabel || selectedBlockLabel) && (
          <p className="v2-chat__context">
            {focusedSlideLabel && <span>Viewing <strong>{focusedSlideLabel}</strong></span>}
            {selectedBlockLabel && <span> · selected <strong>{selectedBlockLabel}</strong></span>}
          </p>
        )}
        <label className="v2-visually-hidden" htmlFor="v2-prompt">What would you like to change?</label>
        <textarea
          id="v2-prompt"
          ref={inputRef}
          className="v2-input"
          rows={3}
          placeholder="Ask for an edit, a new slide, a chart, sources, images or a new look…"
          value={prompt}
          onChange={(event) => setPrompt(event.target.value)}
          onKeyDown={handleKeyDown}
          disabled={disabled}
          maxLength={8_000}
        />
        <div className="v2-chat__actions">
          <span className="v2-hint">Enter to send · Shift+Enter for a new line</span>
          {busy ? (
            <button type="button" className="v2-button v2-button--ghost" onClick={onCancel}>Cancel</button>
          ) : (
            <button type="button" className="v2-button v2-button--primary" disabled={!prompt.trim() || disabled} onClick={() => send()}>Send</button>
          )}
        </div>
      </div>
    </section>
  )
}
