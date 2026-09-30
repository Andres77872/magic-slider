import { useEffect, useId, useMemo, useRef, useState, type RefObject } from 'react'

import { primitives } from '../../catalog/registry'
import type { PrimitiveCategory } from '../../catalog/types'
import Icon, { primitiveIcons } from '../common/Icon'
import { Popover } from '../common/Popover'

const categoryTitles: Record<PrimitiveCategory, string> = {
  text: 'Text',
  media: 'Media',
  data: 'Data',
  narrative: 'Narrative',
  layout: 'Layout',
}
const categoryOrder: PrimitiveCategory[] = ['text', 'media', 'data', 'narrative', 'layout']

interface InsertMenuProps {
  anchorRef: RefObject<HTMLElement | null>
  open: boolean
  /** Where the block will go, e.g. "after heading" or "inside box". */
  placementLabel: string
  onInsert: (type: string) => void
  onClose: () => void
}

/**
 * The block picker: every primitive in the catalog, grouped by category with
 * search. It follows the combobox pattern: focus stays in the search field
 * and arrow keys move the active option.
 */
export default function InsertMenu({ anchorRef, open, placementLabel, onInsert, onClose }: InsertMenuProps) {
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const listId = useId()

  const results = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return categoryOrder.flatMap((category) => primitives
      .filter((primitive) => primitive.category === category)
      .filter((primitive) => !needle || primitive.type.includes(needle) || primitive.summary.toLowerCase().includes(needle) || categoryTitles[category].toLowerCase().includes(needle)))
  }, [query])

  useEffect(() => {
    if (!open) return
    setQuery('')
    setActive(0)
    const frame = requestAnimationFrame(() => inputRef.current?.focus())
    return () => cancelAnimationFrame(frame)
  }, [open])

  useEffect(() => {
    listRef.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [active])

  const choose = (type: string | undefined) => {
    if (!type) return
    onInsert(type)
    onClose()
  }

  let lastCategory: PrimitiveCategory | null = null
  return (
    <Popover anchorRef={anchorRef} open={open} onClose={onClose} placement="bottom-start" className="v2-insert" label="Insert a block">
      <div className="v2-insert__search">
        <Icon name="search" />
        <input
          ref={inputRef}
          type="search"
          className="v2-insert__input"
          placeholder="Search blocks…"
          value={query}
          role="combobox"
          aria-label="Search blocks"
          aria-expanded="true"
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={results[active] ? `${listId}-${results[active].type}` : undefined}
          onChange={(event) => { setQuery(event.target.value); setActive(0) }}
          onKeyDown={(event) => {
            if (event.key === 'ArrowDown') { event.preventDefault(); setActive((index) => Math.min(index + 1, results.length - 1)) }
            else if (event.key === 'ArrowUp') { event.preventDefault(); setActive((index) => Math.max(index - 1, 0)) }
            else if (event.key === 'Enter') { event.preventDefault(); choose(results[active]?.type) }
          }}
        />
      </div>
      <p className="v2-insert__placement">Inserts {placementLabel}</p>
      <div ref={listRef} id={listId} role="listbox" aria-label="Blocks" className="v2-insert__list">
        {results.length === 0 && <p className="v2-insert__empty">No block matches “{query}”.</p>}
        {results.map((primitive, index) => {
          const header = primitive.category !== lastCategory ? categoryTitles[primitive.category] : null
          lastCategory = primitive.category
          return (
            <div key={primitive.type} role="presentation">
              {header && <p className="v2-insert__group" role="presentation">{header}</p>}
              <div
                id={`${listId}-${primitive.type}`}
                role="option"
                aria-selected={index === active}
                data-index={index}
                className={`v2-insert__option${index === active ? ' v2-insert__option--active' : ''}`}
                onPointerEnter={() => setActive(index)}
                onPointerDown={(event) => event.preventDefault()}
                onClick={() => choose(primitive.type)}
              >
                <span className="v2-insert__icon"><Icon name={primitiveIcons[primitive.type] ?? 'square'} size={18} /></span>
                <span className="v2-insert__text">
                  <strong>{primitive.type}</strong>
                  <span>{primitive.summary}</span>
                </span>
              </div>
            </div>
          )
        })}
      </div>
    </Popover>
  )
}
