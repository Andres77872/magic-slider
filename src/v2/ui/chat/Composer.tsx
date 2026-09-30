import { useEffect, useId, useImperativeHandle, useMemo, useRef, useState, type DragEvent, type KeyboardEvent, type ReactNode, type Ref } from 'react'

import {
  activeMentionQuery, insertMention, mentionRanges, mentionSuggestions, removeMention, resolveMentions, type ResolvedReference,
} from '../../agent/references'
import type { Deck } from '../../domain/deckSchema'
import Icon, { primitiveIcons } from '../common/Icon'
import { REFERENCE_MIME, hasReference } from './referenceDrag'

export interface ComposerHandle {
  /** Inserts "@id" at the caret (or appends) and focuses the composer. */
  insertReference: (id: string) => void
  focus: () => void
}

export interface SendOptions {
  /** Whether the suggested selection chip was left in place (sent as a hint). */
  includeSelection: boolean
}

interface ComposerProps {
  ref?: Ref<ComposerHandle>
  deck: Deck | null
  activeSlideId: string | null
  /** The element or slide selected on the canvas, offered as a suggested reference. */
  selection: ResolvedReference | null
  busy: boolean
  disabled?: boolean
  placeholder?: string
  quickActions?: ReactNode
  onSend: (text: string, options: SendOptions) => void
  onCancel: () => void
  onNavigate: (reference: Pick<ResolvedReference, 'id' | 'kind' | 'slideId'>) => void
}

export const MAX_PROMPT_LENGTH = 8_000

function ReferenceChip({ reference, onRemove, onNavigate }: { reference: ResolvedReference; onRemove: () => void; onNavigate: () => void }) {
  return (
    <span className={`v2-refchip v2-refchip--${reference.kind}`}>
      <button type="button" className="v2-refchip__main" title={`Show @${reference.id}`} onClick={onNavigate}>
        <Icon name={primitiveIcons[reference.type] ?? 'square'} size={13} />
        <span className="v2-refchip__label">{reference.label}</span>
      </button>
      <button type="button" className="v2-refchip__remove" aria-label={`Remove reference @${reference.id}`} onClick={onRemove}><Icon name="x" size={12} /></button>
    </span>
  )
}

/**
 * The chat composer. References live in the text as "@id" tokens; the chip
 * tray, the highlighting and the request payload are derived from them.
 * Typing "@" opens suggestions (WAI-ARIA combobox: focus stays in the
 * textarea, arrows move the active option, Enter or Tab accepts, Escape
 * closes only the popup).
 */
export default function Composer({ ref, deck, activeSlideId, selection, busy, disabled, placeholder, quickActions, onSend, onCancel, onNavigate }: ComposerProps) {
  const [text, setText] = useState('')
  const [caret, setCaret] = useState(0)
  const [active, setActive] = useState(0)
  const [popupClosed, setPopupClosed] = useState(false)
  const [dismissedSelection, setDismissedSelection] = useState<string | null>(null)
  const [dragOver, setDragOver] = useState(false)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const backdropRef = useRef<HTMLDivElement>(null)
  const listId = useId()
  const inputId = useId()

  const mention = activeMentionQuery(text, caret)
  const suggestions = useMemo(() => (mention && deck ? mentionSuggestions(deck, mention.query, activeSlideId, 30) : []), [mention?.query, mention?.start, deck, activeSlideId])
  const popupOpen = Boolean(mention && deck && !popupClosed)
  const { resolved, missing: unresolved } = useMemo(() => resolveMentions(deck, text), [deck, text])
  // The token being typed is not "missing" yet: it is a query for the popup.
  const typing = popupOpen && mention ? text.slice(mention.start + 1, caret) : null
  const missing = typing === null ? unresolved : unresolved.filter((id) => id !== typing.replace(/[-_]+$/, ''))
  const selectionMentioned = selection ? resolved.some((reference) => reference.id === selection.id) : false
  const showSelection = Boolean(selection && !selectionMentioned && dismissedSelection !== selection.id)

  useEffect(() => { setActive(0) }, [mention?.query])
  useEffect(() => { setPopupClosed(false) }, [mention?.start])

  const replaceText = (next: string, nextCaret: number) => {
    setText(next.slice(0, MAX_PROMPT_LENGTH))
    setCaret(nextCaret)
    // Focus now so keys typed right away land in the composer; place the caret once React has rendered.
    inputRef.current?.focus()
    requestAnimationFrame(() => inputRef.current?.setSelectionRange(nextCaret, nextCaret))
  }

  const insertAtCaret = (id: string) => {
    const input = inputRef.current
    const position = input && document.activeElement === input ? input.selectionStart ?? text.length : text.length
    const result = insertMention(text, position, id)
    replaceText(result.text, result.caret)
  }

  useImperativeHandle(ref, () => ({
    insertReference: (id: string) => {
      if (resolveMentions(deck, text).resolved.some((reference) => reference.id === id)) {
        inputRef.current?.focus()
        return
      }
      insertAtCaret(id)
    },
    focus: () => inputRef.current?.focus(),
  }))

  const accept = (index: number) => {
    const suggestion = suggestions[index]
    if (!suggestion || !mention) return
    const result = insertMention(text, caret, suggestion.id, mention.start)
    replaceText(result.text, result.caret)
  }

  const send = () => {
    const trimmed = text.trim()
    if (!trimmed || busy || disabled) return
    // The selection stays a hint unless the user dismissed it (mentioning it makes it explicit too).
    onSend(trimmed, { includeSelection: !(selection && dismissedSelection === selection.id) })
    setText('')
    setCaret(0)
    setDismissedSelection(null)
  }

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (popupOpen && suggestions.length) {
      if (event.key === 'ArrowDown') { event.preventDefault(); setActive((index) => (index + 1) % suggestions.length); return }
      if (event.key === 'ArrowUp') { event.preventDefault(); setActive((index) => (index - 1 + suggestions.length) % suggestions.length); return }
      if ((event.key === 'Enter' || event.key === 'Tab') && !event.nativeEvent.isComposing) { event.preventDefault(); accept(active); return }
    }
    if (event.key === 'Escape' && popupOpen) {
      event.preventDefault()
      event.stopPropagation()
      setPopupClosed(true)
      return
    }
    // Backspace right after a mention removes the whole token.
    if (event.key === 'Backspace' && event.currentTarget.selectionStart === event.currentTarget.selectionEnd) {
      const position = event.currentTarget.selectionStart ?? 0
      const range = mentionRanges(text).find((candidate) => candidate.end === position && deck && resolved.some((reference) => reference.id === candidate.id))
      if (range) {
        event.preventDefault()
        replaceText(`${text.slice(0, range.start)}${text.slice(range.end)}`, range.start)
        return
      }
    }
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault()
      send()
    }
  }

  const onDragOver = (event: DragEvent<HTMLDivElement>) => {
    if (!hasReference([...event.dataTransfer.types]) || disabled) return
    event.preventDefault()
    event.dataTransfer.dropEffect = 'copy'
    setDragOver(true)
  }
  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    setDragOver(false)
    const id = event.dataTransfer.getData(REFERENCE_MIME)
    if (!id) return
    event.preventDefault()
    const input = inputRef.current
    const already = resolveMentions(deck, text).resolved.some((reference) => reference.id === id)
    if (already) return
    const result = insertMention(text, input?.selectionStart ?? text.length, id)
    replaceText(result.text, result.caret)
  }

  // Mirror of the text with mentions highlighted, drawn behind the transparent textarea.
  const highlighted = useMemo(() => {
    const parts: ReactNode[] = []
    let cursor = 0
    const known = new Set(resolved.map((reference) => reference.id))
    mentionRanges(text).forEach((range, index) => {
      parts.push(text.slice(cursor, range.start))
      parts.push(<mark key={index} className={known.has(range.id) ? 'v2-mention' : 'v2-mention v2-mention--missing'}>{text.slice(range.start, range.end)}</mark>)
      cursor = range.end
    })
    parts.push(`${text.slice(cursor)}\n`)
    return parts
  }, [text, resolved])

  const activeOption = popupOpen && suggestions[active] ? `${listId}-${active}` : undefined

  return (
    <div className={`v2-composer${dragOver ? ' v2-composer--drop' : ''}`} onDragOver={onDragOver} onDragLeave={() => setDragOver(false)} onDrop={onDrop}>
      {popupOpen && (
        <div className="v2-mentions" role="presentation">
          <p className="v2-mentions__title">{mention?.query ? `Matching “${mention.query}”` : 'Reference a slide or element'}</p>
          {suggestions.length ? (
            <ul id={listId} role="listbox" aria-label="Slides and elements" className="v2-mentions__list">
              {suggestions.map((suggestion, index) => (
                <li
                  key={suggestion.id}
                  id={`${listId}-${index}`}
                  role="option"
                  aria-selected={index === active}
                  className={`v2-mentions__option${index === active ? ' v2-mentions__option--active' : ''}${suggestion.kind === 'slide' ? ' v2-mentions__option--slide' : ''}`}
                  style={{ paddingLeft: suggestion.kind === 'block' ? 12 + Math.min(suggestion.depth + 1, 4) * 12 : 10 }}
                  ref={(node) => { if (index === active) node?.scrollIntoView?.({ block: 'nearest' }) }}
                  onPointerDown={(event) => event.preventDefault()}
                  onPointerEnter={() => setActive(index)}
                  onClick={() => accept(index)}
                >
                  <Icon name={primitiveIcons[suggestion.type] ?? 'square'} size={14} />
                  <span className="v2-mentions__label">{suggestion.label}</span>
                  <code className="v2-mentions__id">@{suggestion.id}</code>
                  {suggestion.kind === 'block' && !suggestion.onActiveSlide && <span className="v2-mentions__slide">slide {suggestion.slideIndex + 1}</span>}
                </li>
              ))}
            </ul>
          ) : (
            <p className="v2-mentions__empty">No slide or element matches. Keep typing, or press Esc.</p>
          )}
        </div>
      )}

      {(resolved.length > 0 || missing.length > 0 || showSelection) && (
        <div className="v2-reftray" aria-label="References in this message">
          {resolved.map((reference) => (
            <ReferenceChip key={reference.id} reference={reference} onNavigate={() => onNavigate(reference)} onRemove={() => { const next = removeMention(text, reference.id); replaceText(next, next.length) }} />
          ))}
          {missing.map((id) => (
            <span key={id} className="v2-refchip v2-refchip--missing" title="No slide or element has this id; it is sent as plain text.">
              <Icon name="warning" size={13} /><span className="v2-refchip__label">@{id} not found</span>
            </span>
          ))}
          {showSelection && selection && (
            <span className="v2-refchip v2-refchip--suggested" title="Sent as context: the assistant knows what you have selected. Mention it to make it an explicit reference.">
              <button type="button" className="v2-refchip__main" onClick={() => insertAtCaret(selection.id)}>
                <Icon name="plus" size={12} />
                <span className="v2-refchip__label">Selected: {selection.label}</span>
              </button>
              <button type="button" className="v2-refchip__remove" aria-label="Don't send the selection" onClick={() => setDismissedSelection(selection.id)}><Icon name="x" size={12} /></button>
            </span>
          )}
        </div>
      )}

      {quickActions}

      <div className="v2-composer__field">
        <div ref={backdropRef} className="v2-composer__backdrop" aria-hidden="true">{highlighted}</div>
        <label className="v2-visually-hidden" htmlFor={inputId}>What would you like to change?</label>
        <textarea
          id={inputId}
          ref={inputRef}
          className="v2-composer__input"
          rows={3}
          placeholder={placeholder ?? 'Ask for a change… type @ to reference a slide or element'}
          value={text}
          maxLength={MAX_PROMPT_LENGTH}
          disabled={disabled}
          role="combobox"
          aria-expanded={popupOpen}
          aria-controls={popupOpen ? listId : undefined}
          aria-autocomplete="list"
          aria-activedescendant={activeOption}
          onChange={(event) => { setText(event.target.value); setCaret(event.target.selectionStart ?? event.target.value.length) }}
          onSelect={(event) => setCaret(event.currentTarget.selectionStart ?? 0)}
          onScroll={(event) => { if (backdropRef.current) backdropRef.current.scrollTop = event.currentTarget.scrollTop }}
          onKeyDown={onKeyDown}
        />
      </div>

      <div className="v2-composer__actions">
        <button type="button" className="v2-icon-button v2-icon-button--sm" aria-label="Mention a slide or element" title="Mention a slide or element (@)" disabled={disabled || !deck} onClick={() => {
          const input = inputRef.current
          const position = input?.selectionStart ?? text.length
          const before = text.slice(0, position)
          const insert = `${before && !/\s$/.test(before) ? ' ' : ''}@`
          replaceText(`${before}${insert}${text.slice(position)}`, position + insert.length)
        }}><Icon name="at-sign" /></button>
        <span className="v2-hint">Enter to send · Shift+Enter for a new line</span>
        {busy ? (
          <button type="button" className="v2-button v2-button--ghost v2-button--sm" onClick={onCancel}><Icon name="stop" size={14} />Stop</button>
        ) : (
          <button type="button" className="v2-button v2-button--primary v2-button--sm" disabled={!text.trim() || disabled} onClick={send}><Icon name="send" size={14} />Send</button>
        )}
      </div>
    </div>
  )
}
