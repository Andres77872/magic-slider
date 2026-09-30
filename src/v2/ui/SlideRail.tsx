import { useRef, useState, type DragEvent, type KeyboardEvent } from 'react'

import type { Deck } from '../domain/deckSchema'
import { slideStarters } from '../domain/slideStarters'
import type { FitScales } from '../render/fit'
import type { ResolvedTheme } from '../render/theme'
import { REFERENCE_MIME } from './chat/referenceDrag'
import Icon from './common/Icon'
import { Menu, MenuButton, type MenuItem } from './common/Popover'
import { MOD } from './common/ShortcutsDialog'
import SlideThumbnail from './SlideThumbnail'

export type SlideAction = 'duplicate' | 'delete' | 'reference' | 'move-back' | 'move-forward' | 'copy' | 'paste'

interface SlideRailProps {
  deck: Deck
  theme: ResolvedTheme
  fitScales: FitScales
  activeIndex: number
  disabled?: boolean
  canPaste?: boolean
  onSelect: (index: number) => void
  /** Moves a slide so it lands at targetIndex. */
  onMoveTo: (slideId: string, targetIndex: number) => void
  onAction: (action: SlideAction, slideId: string) => void
  onAddSlide: (starterId: string, afterSlideId: string | null) => void
}

const THUMB_WIDTH = 160
const SLIDE_MIME = 'text/x-ms-slide'

/**
 * The filmstrip (WAI-ARIA listbox): selection follows focus; ←/→ move,
 * Alt or Ctrl/⌘ with ←/→ reorders, Delete removes, Ctrl/⌘+D duplicates,
 * "@" references the slide in chat, Shift+F10 or right-click opens the slide
 * menu. Thumbnails can be dragged to reorder, or onto the chat to reference.
 */
export default function SlideRail({ deck, theme, fitScales, activeIndex, disabled, canPaste, onSelect, onMoveTo, onAction, onAddSlide }: SlideRailProps) {
  const [dragging, setDragging] = useState<string | null>(null)
  const [dropTarget, setDropTarget] = useState<number | null>(null)
  const [menuFor, setMenuFor] = useState<number | null>(null)
  const listRef = useRef<HTMLOListElement>(null)
  const menuAnchor = useRef<HTMLElement | null>(null)
  const [announcement, setAnnouncement] = useState('')

  const focusOption = (index: number) => {
    const clamped = Math.max(0, Math.min(index, deck.slides.length - 1))
    onSelect(clamped)
    requestAnimationFrame(() => listRef.current?.querySelector<HTMLElement>(`[data-index="${clamped}"]`)?.focus())
  }

  const move = (index: number, delta: -1 | 1) => {
    const target = index + delta
    if (disabled || target < 0 || target >= deck.slides.length) return
    onMoveTo(deck.slides[index].id, target)
    setAnnouncement(`Slide moved to position ${target + 1} of ${deck.slides.length}.`)
    requestAnimationFrame(() => listRef.current?.querySelector<HTMLElement>(`[data-index="${target}"]`)?.focus())
  }

  const openMenu = (index: number, anchor: HTMLElement) => {
    menuAnchor.current = anchor
    setMenuFor(index)
  }

  const onKeyDown = (event: KeyboardEvent<HTMLElement>, index: number) => {
    const slideId = deck.slides[index].id
    const mod = event.metaKey || event.ctrlKey
    const back = event.key === 'ArrowLeft' || event.key === 'ArrowUp'
    const forward = event.key === 'ArrowRight' || event.key === 'ArrowDown'
    if ((back || forward) && (event.altKey || mod)) {
      event.preventDefault()
      move(index, back ? -1 : 1)
    } else if (back || forward) {
      event.preventDefault()
      focusOption(index + (back ? -1 : 1))
    } else if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault()
      focusOption(event.key === 'Home' ? 0 : deck.slides.length - 1)
    } else if ((event.key === 'Delete' || event.key === 'Backspace') && !disabled) {
      event.preventDefault()
      onAction('delete', slideId)
    } else if (mod && event.key.toLowerCase() === 'd' && !disabled) {
      event.preventDefault()
      onAction('duplicate', slideId)
    } else if (event.key === '@') {
      event.preventDefault()
      onAction('reference', slideId)
    } else if ((event.shiftKey && event.key === 'F10') || event.key === 'ContextMenu') {
      event.preventDefault()
      openMenu(index, event.currentTarget)
    } else if (event.key === 'Enter') {
      event.preventDefault()
      document.querySelector<HTMLElement>('[data-testid="v2-edit-canvas"]')?.focus()
    } else {
      return
    }
    event.stopPropagation()
  }

  const onDragStart = (event: DragEvent<HTMLElement>, slideId: string) => {
    event.dataTransfer.setData(SLIDE_MIME, slideId)
    event.dataTransfer.setData(REFERENCE_MIME, slideId)
    event.dataTransfer.setData('text/plain', `@${slideId}`)
    event.dataTransfer.effectAllowed = 'copyMove'
    setDragging(slideId)
  }

  const onDrop = (event: DragEvent<HTMLElement>, index: number) => {
    event.preventDefault()
    const slideId = event.dataTransfer.getData(SLIDE_MIME) || dragging
    setDragging(null)
    setDropTarget(null)
    if (!slideId || disabled) return
    const from = deck.slides.findIndex((slide) => slide.id === slideId)
    if (from === -1 || from === index) return
    // Dragging forward drops after the target (so the last position is reachable); backward drops before it.
    onMoveTo(slideId, index)
    setAnnouncement(`Slide moved to position ${index + 1} of ${deck.slides.length}.`)
  }

  const menuItems = (index: number): MenuItem[] => {
    const slideId = deck.slides[index].id
    return [
      { id: 'reference', label: 'Reference in chat', icon: 'at-sign', shortcut: '@', onSelect: () => onAction('reference', slideId) },
      { id: 'duplicate', label: 'Duplicate', icon: 'duplicate', shortcut: `${MOD}+D`, disabled, onSelect: () => onAction('duplicate', slideId), separatorBefore: true },
      { id: 'copy', label: 'Copy', icon: 'copy', shortcut: `${MOD}+C`, onSelect: () => onAction('copy', slideId) },
      { id: 'paste', label: 'Paste after', icon: 'paste', shortcut: `${MOD}+V`, disabled: disabled || !canPaste, onSelect: () => onAction('paste', slideId) },
      { id: 'back', label: 'Move earlier', icon: 'arrow-up', shortcut: 'Alt+←', disabled: disabled || index === 0, onSelect: () => onAction('move-back', slideId), separatorBefore: true },
      { id: 'forward', label: 'Move later', icon: 'arrow-down', shortcut: 'Alt+→', disabled: disabled || index === deck.slides.length - 1, onSelect: () => onAction('move-forward', slideId) },
      { id: 'delete', label: 'Delete slide', icon: 'trash', shortcut: 'Del', danger: true, disabled: disabled || deck.slides.length <= 1, onSelect: () => onAction('delete', slideId), separatorBefore: true },
    ]
  }

  const addItems = (afterSlideId: string | null): MenuItem[] => slideStarters.map((starter) => ({
    id: starter.id,
    label: starter.label,
    icon: starter.icon as MenuItem['icon'],
    onSelect: () => onAddSlide(starter.id, afterSlideId),
  }))

  return (
    <nav className="v2-rail" aria-label="Slides">
      <ol ref={listRef} className="v2-rail__list" role="listbox" aria-label="Slides" aria-orientation="horizontal">
        {deck.slides.map((slide, index) => {
          const scale = fitScales[slide.id]
          const active = index === activeIndex
          const dropSide = dropTarget === index && dragging ? (deck.slides.findIndex((candidate) => candidate.id === dragging) < index ? 'after' : 'before') : null
          return (
            <li key={slide.id} className={`v2-rail__item${dropSide ? ` v2-rail__item--drop-${dropSide}` : ''}`} role="presentation">
              <div
                role="option"
                aria-selected={active}
                aria-label={`Slide ${index + 1} of ${deck.slides.length}${slide.name ? `: ${slide.name}` : ''}`}
                data-index={index}
                tabIndex={active ? 0 : -1}
                className={`v2-rail__option${active ? ' v2-rail__option--active' : ''}`}
                draggable
                onClick={() => onSelect(index)}
                onKeyDown={(event) => onKeyDown(event, index)}
                onContextMenu={(event) => { event.preventDefault(); onSelect(index); openMenu(index, event.currentTarget) }}
                onDragStart={(event) => onDragStart(event, slide.id)}
                onDragEnd={() => { setDragging(null); setDropTarget(null) }}
                onDragOver={(event) => { if (dragging && !disabled) { event.preventDefault(); event.dataTransfer.dropEffect = 'move'; setDropTarget(index) } }}
                onDragLeave={() => setDropTarget((current) => (current === index ? null : current))}
                onDrop={(event) => onDrop(event, index)}
              >
                <SlideThumbnail deck={deck} slide={slide} theme={theme} fitScale={scale} width={THUMB_WIDTH} />
                <span className="v2-rail__label">
                  <span className="v2-rail__number">{index + 1}</span>
                  <span className="v2-rail__name">{slide.name ?? slide.id}</span>
                  {scale !== undefined && scale < 0.9 && <span className="v2-rail__fit" title={`Content scaled to ${Math.round(scale * 100)}% to fit`}>{Math.round(scale * 100)}%</span>}
                </span>
              </div>
              <button
                type="button"
                className="v2-rail__more"
                tabIndex={-1}
                aria-label={`Slide ${index + 1} actions`}
                aria-haspopup="menu"
                onClick={(event) => { onSelect(index); openMenu(index, event.currentTarget) }}
              >
                <Icon name="more" size={14} />
              </button>
            </li>
          )
        })}
      </ol>
      <MenuButton label="Add a slide" items={addItems(deck.slides[activeIndex]?.id ?? null)} className="v2-rail__add" placement="top-end" disabled={disabled} title="Add a slide after the current one">
        <Icon name="plus" size={20} />
        <span>New slide</span>
      </MenuButton>
      <Menu
        anchorRef={menuAnchor}
        open={menuFor !== null}
        label="Slide actions"
        items={menuFor !== null && deck.slides[menuFor] ? menuItems(menuFor) : []}
        placement="top-start"
        onClose={() => setMenuFor(null)}
      />
      <p className="v2-visually-hidden" aria-live="polite">{announcement}</p>
    </nav>
  )
}
