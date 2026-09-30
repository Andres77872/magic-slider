import { useRef, type DragEvent, type KeyboardEvent } from 'react'

import { getPrimitive } from '../../catalog/registry'
import type { Block } from '../../catalog/types'
import type { Slide } from '../../domain/deckSchema'
import Icon, { primitiveIcons } from '../common/Icon'
import { REFERENCE_MIME } from '../chat/referenceDrag'

export type LayerAction = 'up' | 'down' | 'duplicate' | 'delete' | 'reference'

interface LayersPanelProps {
  slide: Slide
  selectedBlockId: string | null
  disabled?: boolean
  onSelect: (blockId: string | null) => void
  onAction: (action: LayerAction, blockId: string) => void
}

interface Row {
  block: Block
  depth: number
}

function flatten(blocks: readonly Block[], depth = 0, into: Row[] = []): Row[] {
  for (const block of blocks) {
    into.push({ block, depth })
    if (block.children?.length) flatten(block.children, depth + 1, into)
  }
  return into
}

/**
 * The slide's block tree (WAI-ARIA tree view): arrow keys move, Enter selects,
 * Alt+↑/↓ reorders, Delete removes, "@" references the block in chat. Rows
 * can be dragged into the chat composer.
 */
export default function LayersPanel({ slide, selectedBlockId, disabled, onSelect, onAction }: LayersPanelProps) {
  const treeRef = useRef<HTMLUListElement>(null)
  const rows = flatten(slide.blocks)
  const activeIndex = Math.max(0, rows.findIndex((row) => row.block.id === selectedBlockId))

  const focusRow = (index: number) => {
    const items = treeRef.current?.querySelectorAll<HTMLElement>('[role="treeitem"]')
    const item = items?.[Math.max(0, Math.min(index, (items?.length ?? 1) - 1))]
    item?.focus()
    const id = item?.getAttribute('data-block-id')
    if (id) onSelect(id)
  }

  const onKeyDown = (event: KeyboardEvent<HTMLElement>, index: number, block: Block) => {
    const id = block.id!
    if (event.altKey && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
      event.preventDefault()
      if (!disabled) onAction(event.key === 'ArrowUp' ? 'up' : 'down', id)
      return
    }
    switch (event.key) {
      case 'ArrowDown': event.preventDefault(); focusRow(index + 1); break
      case 'ArrowUp': event.preventDefault(); focusRow(index - 1); break
      case 'Home': event.preventDefault(); focusRow(0); break
      case 'End': event.preventDefault(); focusRow(rows.length - 1); break
      case 'ArrowLeft': {
        event.preventDefault()
        for (let parentIndex = index - 1; parentIndex >= 0; parentIndex -= 1) {
          if (rows[parentIndex].depth < rows[index].depth) {
            focusRow(parentIndex)
            break
          }
        }
        break
      }
      case 'Enter':
      case ' ': event.preventDefault(); onSelect(id); break
      case 'Delete':
      case 'Backspace': event.preventDefault(); if (!disabled) onAction('delete', id); break
      case '@': event.preventDefault(); onAction('reference', id); break
      default: break
    }
  }

  const onDragStart = (event: DragEvent<HTMLElement>, block: Block) => {
    event.dataTransfer.setData(REFERENCE_MIME, block.id!)
    event.dataTransfer.setData('text/plain', `@${block.id}`)
    event.dataTransfer.effectAllowed = 'copy'
  }

  if (!rows.length) return <p className="v2-muted v2-small">This slide has no blocks yet. Use Insert or ask the assistant.</p>

  return (
    <div className="v2-layers">
      <p className="v2-muted v2-small">Drag a layer into the chat to reference it. Alt+↑/↓ reorders.</p>
      <ul ref={treeRef} className="v2-layers__tree" role="tree" aria-label={`Layers of slide ${slide.name ?? slide.id}`}>
        {rows.map(({ block, depth }, index) => {
          const primitive = getPrimitive(block.type)
          const outline = primitive?.outline ? primitive.outline(block as never) : ''
          const selected = block.id === selectedBlockId
          return (
            <li
              key={block.id}
              role="treeitem"
              aria-level={depth + 1}
              aria-selected={selected}
              aria-expanded={block.children?.length ? true : undefined}
              data-block-id={block.id}
              tabIndex={index === activeIndex ? 0 : -1}
              className={`v2-layer${selected ? ' v2-layer--selected' : ''}`}
              style={{ paddingLeft: 8 + depth * 14 }}
              draggable
              onDragStart={(event) => onDragStart(event, block)}
              onClick={() => onSelect(block.id!)}
              onKeyDown={(event) => onKeyDown(event, index, block)}
            >
              <Icon name={primitiveIcons[block.type] ?? 'square'} size={14} />
              <span className="v2-layer__type">{block.type}</span>
              <span className="v2-layer__text">{outline || block.id}</span>
              <span className="v2-layer__actions">
                <button type="button" tabIndex={-1} className="v2-mini" aria-label={`Reference ${block.id} in chat`} title="Reference in chat (@)" onClick={(event) => { event.stopPropagation(); onAction('reference', block.id!) }}><Icon name="at-sign" size={12} /></button>
                <button type="button" tabIndex={-1} className="v2-mini" aria-label={`Move ${block.id} up`} disabled={disabled} onClick={(event) => { event.stopPropagation(); onAction('up', block.id!) }}><Icon name="arrow-up" size={12} /></button>
                <button type="button" tabIndex={-1} className="v2-mini" aria-label={`Move ${block.id} down`} disabled={disabled} onClick={(event) => { event.stopPropagation(); onAction('down', block.id!) }}><Icon name="arrow-down" size={12} /></button>
                <button type="button" tabIndex={-1} className="v2-mini v2-mini--danger" aria-label={`Delete ${block.id}`} disabled={disabled} onClick={(event) => { event.stopPropagation(); onAction('delete', block.id!) }}><Icon name="trash" size={12} /></button>
              </span>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
