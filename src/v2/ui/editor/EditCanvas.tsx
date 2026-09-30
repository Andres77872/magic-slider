import { useCallback, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type MouseEvent, type PointerEvent, type ReactNode } from 'react'

import { getPrimitive } from '../../catalog/registry'
import type { Deck, Slide } from '../../domain/deckSchema'
import { locateBlock } from '../../domain/tree'
import { ensureDeckFonts } from '../../render/fonts'
import { CANVAS, applyThemeVariables, hydrateStaticMedia, renderSlide } from '../../render/renderDeck'
import type { ResolvedTheme } from '../../render/theme'
import Icon, { primitiveIcons } from '../common/Icon'
import { resolveInlineTarget, supportsInlineEdit, type InlineTarget } from './inlineEdit'

interface Rect {
  left: number
  top: number
  width: number
  height: number
}

interface EditCanvasProps {
  deck: Deck
  slide: Slide
  theme: ResolvedTheme
  fitScale?: number
  selectedBlockId: string | null
  editingBlockId: string | null
  /** Selection and inspection only (for example while the agent works). */
  readOnly?: boolean
  onSelect: (blockId: string | null) => void
  onRequestEdit: (blockId: string) => void
  onCommitEdit: (blockId: string, set: Record<string, unknown>) => void
  onEditError: (message: string) => void
  onEndEdit: () => void
  onInsert: () => void
  /** Contextual toolbar shown above the selected block. */
  toolbar?: ReactNode
}

const TOOLBAR_CLEARANCE = 46

function relativeRect(node: Element, frame: HTMLElement): Rect {
  const box = node.getBoundingClientRect()
  const origin = frame.getBoundingClientRect()
  return { left: box.left - origin.left, top: box.top - origin.top, width: box.width, height: box.height }
}

function blockNode(root: ParentNode | null, blockId: string | null): HTMLElement | null {
  if (!root || !blockId) return null
  for (const node of root.querySelectorAll<HTMLElement>('[data-block-id]')) {
    if (node.getAttribute('data-block-id') === blockId) return node
  }
  return null
}

/**
 * The edit surface: one slide rendered statically (all fragments visible) at
 * canvas size and scaled to fit, with hover and selection overlays, inline
 * text editing and a contextual toolbar. Presenting and transitions stay in
 * the Reveal preview; editing never re-initializes a viewer.
 */
export default function EditCanvas({
  deck, slide, theme, fitScale, selectedBlockId, editingBlockId, readOnly, onSelect, onRequestEdit, onCommitEdit, onEditError, onEndEdit, onInsert, toolbar,
}: EditCanvasProps) {
  const viewportRef = useRef<HTMLDivElement>(null)
  const frameRef = useRef<HTMLDivElement>(null)
  const hostRef = useRef<HTMLDivElement>(null)
  const toolbarRef = useRef<HTMLDivElement>(null)
  const pendingTarget = useRef<Element | null>(null)
  const [scale, setScale] = useState(0.5)
  const [renderVersion, setRenderVersion] = useState(0)
  const [hoverId, setHoverId] = useState<string | null>(null)
  const [hoverRect, setHoverRect] = useState<Rect | null>(null)
  const [selectionRect, setSelectionRect] = useState<Rect | null>(null)
  const [toolbarLeft, setToolbarLeft] = useState(0)
  const [editHint, setEditHint] = useState<string | null>(null)
  const canvas = CANVAS[deck.settings?.aspectRatio ?? '16:9']
  const slideKey = JSON.stringify(slide)
  const callbacks = useRef({ onCommitEdit, onEditError, onEndEdit })
  callbacks.current = { onCommitEdit, onEditError, onEndEdit }

  // Fit the canvas into the available space.
  useLayoutEffect(() => {
    const viewport = viewportRef.current
    if (!viewport) return undefined
    const fit = () => {
      const width = viewport.clientWidth - 32
      const height = viewport.clientHeight - 32
      if (width <= 0 || height <= 0) return
      setScale(Math.max(0.1, Math.min(width / canvas.width, height / canvas.height)))
    }
    fit()
    if (typeof ResizeObserver === 'undefined') return undefined
    const observer = new ResizeObserver(fit)
    observer.observe(viewport)
    return () => observer.disconnect()
  }, [canvas.width, canvas.height])

  // Render the slide with the same primitive renderer as thumbnails and export.
  useLayoutEffect(() => {
    const host = hostRef.current
    if (!host) return
    // The deck changed under an inline edit (for example an agent result): save the typed text first.
    const editing = host.querySelector<HTMLElement>('.ms-inline-editing')
    if (editing && editing === document.activeElement) editing.blur()
    const root = document.createElement('div')
    root.className = `ms-deck ms-edit__deck ms-mode-${theme.mode}`
    applyThemeVariables(root, theme)
    root.style.setProperty('--ms-canvas-width', `${canvas.width}px`)
    root.style.setProperty('--ms-canvas-height', `${canvas.height}px`)
    if (deck.language) root.lang = deck.language
    const { element } = renderSlide(slide, deck, theme, 'thumbnail')
    const content = element.querySelector<HTMLElement>('.ms-slide__content')
    if (content && fitScale && fitScale < 1) {
      content.classList.add('ms-fit')
      content.style.setProperty('--ms-fit', String(fitScale))
    }
    hydrateStaticMedia(element)
    root.appendChild(element)
    host.replaceChildren(root)
    ensureDeckFonts(theme)
    setRenderVersion((version) => version + 1)
    // slideKey stands in for the slide object, whose identity changes on every normalization.
  }, [slideKey, theme, fitScale, canvas.width, canvas.height, deck.language])

  const measure = useCallback(() => {
    const frame = frameRef.current
    const host = hostRef.current
    if (!frame || !host) return
    const selected = blockNode(host, selectedBlockId)
    setSelectionRect(selected ? relativeRect(selected, frame) : null)
    const hovered = hoverId && hoverId !== selectedBlockId ? blockNode(host, hoverId) : null
    setHoverRect(hovered ? relativeRect(hovered, frame) : null)
  }, [selectedBlockId, hoverId])

  useLayoutEffect(() => {
    measure()
  }, [measure, renderVersion, scale])

  useEffect(() => {
    // Images and fonts settle after the first layout.
    const host = hostRef.current
    if (!host) return undefined
    const images = [...host.querySelectorAll('img')]
    images.forEach((image) => image.addEventListener('load', measure))
    void document.fonts?.ready.then(measure)
    return () => images.forEach((image) => image.removeEventListener('load', measure))
  }, [measure, renderVersion])

  // Keep the contextual toolbar inside the frame.
  useLayoutEffect(() => {
    const bar = toolbarRef.current
    const frame = frameRef.current
    if (!bar || !frame || !selectionRect) return
    const max = Math.max(0, frame.clientWidth - bar.offsetWidth)
    setToolbarLeft(Math.min(Math.max(selectionRect.left, 0), max))
  }, [selectionRect, toolbar])

  // Inline editing: swap the element's rendered text for its editable source.
  useEffect(() => {
    if (!editingBlockId) return undefined
    const host = hostRef.current
    const node = blockNode(host, editingBlockId)
    const located = locateBlock(deck, editingBlockId)
    const hint = pendingTarget.current
    pendingTarget.current = null
    const target: InlineTarget | null = node && located ? resolveInlineTarget(located.block, node, hint) : null
    if (!target) {
      callbacks.current.onEndEdit()
      return undefined
    }
    const { element } = target
    element.classList.add('ms-inline-editing')
    element.textContent = target.value
    element.setAttribute('contenteditable', 'plaintext-only')
    if (element.contentEditable !== 'plaintext-only') element.setAttribute('contenteditable', 'true')
    element.setAttribute('role', 'textbox')
    element.setAttribute('aria-multiline', String(target.multiline))
    element.setAttribute('aria-label', `Edit ${target.label}`)
    element.spellcheck = true
    element.focus()
    const range = document.createRange()
    range.selectNodeContents(element)
    const selection = window.getSelection()
    selection?.removeAllRanges()
    selection?.addRange(range)
    setEditHint(`${target.multiline ? 'Enter for a new line · Ctrl/⌘+Enter to save' : 'Enter to save'} · Esc to cancel · Ctrl/⌘+B, I, E, K format`)

    let finished = false
    const finish = (save: boolean) => {
      if (finished) return
      finished = true
      setEditHint(null)
      const result = save ? target.commit(element.innerText ?? element.textContent ?? '') : null
      if (result && 'error' in result) callbacks.current.onEditError(result.error)
      if (result && 'set' in result) callbacks.current.onCommitEdit(editingBlockId, result.set)
      // Re-render the slide from the deck so the edited element shows rendered rich text again.
      else setRenderVersion((version) => version + 1)
      callbacks.current.onEndEdit()
    }
    const markers: Record<string, [string, string]> = { b: ['**', '**'], i: ['*', '*'], e: ['==', '=='], k: ['[', '](https://)'] }
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      event.stopPropagation()
      const marker = (event.metaKey || event.ctrlKey) && !event.altKey ? markers[event.key.toLowerCase()] : undefined
      if (marker) {
        // Rich-text shortcuts wrap the selection in the same markers the Design panel uses.
        event.preventDefault()
        const selected = window.getSelection()?.toString() || 'text'
        document.execCommand?.('insertText', false, `${marker[0]}${selected}${marker[1]}`)
        return
      }
      if (event.key === 'Escape') {
        event.preventDefault()
        finish(false)
      } else if (event.key === 'Enter' && !event.isComposing && (!target.multiline || event.metaKey || event.ctrlKey) && !event.shiftKey) {
        event.preventDefault()
        finish(true)
      }
    }
    const onBlur = () => finish(true)
    const onPaste = (event: ClipboardEvent) => {
      // Rich clipboard content never enters the deck: paste plain text only.
      event.preventDefault()
      const text = event.clipboardData?.getData('text/plain') ?? ''
      document.execCommand?.('insertText', false, text)
    }
    element.addEventListener('keydown', onKeyDown)
    element.addEventListener('blur', onBlur)
    element.addEventListener('paste', onPaste)
    return () => {
      element.removeEventListener('keydown', onKeyDown)
      element.removeEventListener('blur', onBlur)
      element.removeEventListener('paste', onPaste)
      if (!finished) {
        finished = true
        setEditHint(null)
      }
    }
    // The deck is read when editing starts; later deck changes re-render the slide instead.
  }, [editingBlockId])

  const blockAt = (target: EventTarget | null): HTMLElement | null => {
    const element = target instanceof Element ? target : null
    const node = element?.closest<HTMLElement>('[data-block-id]') ?? null
    return node && hostRef.current?.contains(node) ? node : null
  }

  const handleClick = (event: MouseEvent<HTMLDivElement>) => {
    const target = event.target as Element
    if (target.closest('a')) event.preventDefault()
    if (target.closest('.v2-edit__toolbar, .v2-edit__empty')) return
    if (editingBlockId && target.closest('.ms-inline-editing')) return
    const node = blockAt(event.target)
    onSelect(node?.getAttribute('data-block-id') ?? null)
  }

  const handleDoubleClick = (event: MouseEvent<HTMLDivElement>) => {
    if (readOnly) return
    const node = blockAt(event.target)
    const id = node?.getAttribute('data-block-id')
    if (!node || !id) return
    const block = locateBlock(deck, id)?.block
    if (!block || !supportsInlineEdit(block.type)) return
    event.preventDefault()
    pendingTarget.current = event.target as Element
    onSelect(id)
    onRequestEdit(id)
  }

  const handlePointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const id = blockAt(event.target)?.getAttribute('data-block-id') ?? null
    if (id !== hoverId) setHoverId(id)
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Tab' || editingBlockId) return
    const nodes = [...(hostRef.current?.querySelectorAll<HTMLElement>('[data-block-id]') ?? [])]
    if (!nodes.length) return
    const current = nodes.findIndex((node) => node.getAttribute('data-block-id') === selectedBlockId)
    const next = current + (event.shiftKey ? -1 : 1)
    // Leave the canvas at either end instead of trapping focus.
    if ((current === -1 && event.shiftKey) || next < 0 || next >= nodes.length) return
    event.preventDefault()
    onSelect(nodes[current === -1 ? 0 : next].getAttribute('data-block-id'))
  }

  const selected = selectedBlockId ? locateBlock(deck, selectedBlockId) : null
  const hovered = hoverId && hoverId !== selectedBlockId ? locateBlock(deck, hoverId) : null
  const primitiveName = (type: string) => getPrimitive(type)?.type ?? type
  const toolbarBelow = selectionRect ? selectionRect.top < TOOLBAR_CLEARANCE : false

  return (
    <div className="v2-edit" ref={viewportRef}>
      <div
        ref={frameRef}
        className={`v2-edit__frame${readOnly ? ' v2-edit__frame--readonly' : ''}`}
        style={{ width: canvas.width * scale, height: canvas.height * scale }}
        role="region"
        aria-label={`Slide editor: slide ${deck.slides.indexOf(slide) + 1}`}
        aria-describedby="v2-edit-help"
        tabIndex={0}
        onClick={handleClick}
        onDoubleClick={handleDoubleClick}
        onPointerMove={handlePointerMove}
        onPointerLeave={() => setHoverId(null)}
        onKeyDown={handleKeyDown}
        data-testid="v2-edit-canvas"
      >
        <div className="v2-edit__clip">
          <div ref={hostRef} className="v2-edit__host" style={{ transform: `scale(${scale})`, width: canvas.width, height: canvas.height }} />
        </div>
        {hoverRect && hovered && !editingBlockId && (
          <div className="v2-edit__hover" style={hoverRect} aria-hidden="true">
            <span className="v2-edit__tag"><Icon name={primitiveIcons[hovered.block.type] ?? 'square'} size={11} />{primitiveName(hovered.block.type)}</span>
          </div>
        )}
        {selectionRect && selected && (
          <div className={`v2-edit__selection${editingBlockId ? ' v2-edit__selection--editing' : ''}`} style={selectionRect} aria-hidden="true" />
        )}
        {selectionRect && selected && toolbar && !editingBlockId && (
          <div
            ref={toolbarRef}
            className="v2-edit__toolbar"
            style={{ left: toolbarLeft, top: toolbarBelow ? selectionRect.top + selectionRect.height + 8 : selectionRect.top - 8, transform: toolbarBelow ? 'none' : 'translateY(-100%)' }}
          >
            {toolbar}
          </div>
        )}
        {editHint && selectionRect && (
          <p className="v2-edit__hint" style={{ left: Math.max(selectionRect.left, 0), top: selectionRect.top + selectionRect.height + 8 }} role="status">{editHint}</p>
        )}
        {!slide.blocks.length && (
          <div className="v2-edit__empty">
            <p>This slide is empty.</p>
            <button type="button" className="v2-button v2-button--primary" disabled={readOnly} onClick={onInsert}><Icon name="plus" />Insert a block</button>
            <span className="v2-muted v2-small">or describe it in the chat</span>
          </div>
        )}
      </div>
      <p id="v2-edit-help" className="v2-visually-hidden">
        Click an element to select it, double-click or press Enter to edit its text, Escape to select its parent. Tab moves between elements.
      </p>
      <p className="v2-visually-hidden" aria-live="polite">{selected ? `Selected ${selected.block.type} ${selected.block.id}` : ''}</p>
    </div>
  )
}
