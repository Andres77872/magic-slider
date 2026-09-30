import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react'
import { createPortal } from 'react-dom'

import Icon, { type UiIconName } from './Icon'

type Placement = 'bottom-start' | 'bottom-end' | 'top-start' | 'top-end' | 'right-start'

interface PopoverProps {
  anchorRef: RefObject<HTMLElement | null>
  open: boolean
  onClose: (reason: 'escape' | 'outside') => void
  placement?: Placement
  className?: string
  children: ReactNode
  /** Accessible role of the surface (menu, listbox, dialog…). */
  role?: string
  label?: string
  id?: string
}

const GAP = 6
const MARGIN = 8

/**
 * A floating surface anchored to an element, rendered in a portal so panels
 * with overflow never clip it. It flips vertically when it would leave the
 * viewport and closes on Escape or an outside pointer press.
 */
export function Popover({ anchorRef, open, onClose, placement = 'bottom-start', className, children, role = 'dialog', label, id }: PopoverProps) {
  const surfaceRef = useRef<HTMLDivElement>(null)
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null)
  const closeRef = useRef(onClose)
  closeRef.current = onClose

  const place = useCallback(() => {
    const anchor = anchorRef.current
    const surface = surfaceRef.current
    if (!anchor || !surface) return
    const box = anchor.getBoundingClientRect()
    const width = surface.offsetWidth
    const height = surface.offsetHeight
    const viewportWidth = window.innerWidth
    const viewportHeight = window.innerHeight
    let top: number
    let left: number
    if (placement === 'right-start') {
      top = box.top
      left = box.right + GAP
      if (left + width > viewportWidth - MARGIN) left = box.left - width - GAP
    } else {
      const above = placement.startsWith('top')
      top = above ? box.top - height - GAP : box.bottom + GAP
      if (!above && top + height > viewportHeight - MARGIN && box.top - height - GAP > MARGIN) top = box.top - height - GAP
      if (above && top < MARGIN) top = box.bottom + GAP
      left = placement.endsWith('end') ? box.right - width : box.left
    }
    left = Math.max(MARGIN, Math.min(left, viewportWidth - width - MARGIN))
    top = Math.max(MARGIN, Math.min(top, viewportHeight - height - MARGIN))
    setPosition({ top, left })
  }, [anchorRef, placement])

  useLayoutEffect(() => {
    if (!open) {
      setPosition(null)
      return undefined
    }
    place()
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(place)
    if (surfaceRef.current) observer?.observe(surfaceRef.current)
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    return () => {
      observer?.disconnect()
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', place, true)
    }
  }, [open, place])

  useEffect(() => {
    if (!open) return undefined
    const onPointer = (event: PointerEvent) => {
      const target = event.target as Node
      if (surfaceRef.current?.contains(target) || anchorRef.current?.contains(target)) return
      closeRef.current('outside')
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation()
        closeRef.current('escape')
      }
    }
    document.addEventListener('pointerdown', onPointer, true)
    document.addEventListener('keydown', onKey, true)
    return () => {
      document.removeEventListener('pointerdown', onPointer, true)
      document.removeEventListener('keydown', onKey, true)
    }
  }, [open, anchorRef])

  if (!open) return null
  return createPortal(
    <div
      ref={surfaceRef}
      id={id}
      role={role}
      aria-label={label}
      className={`v2-popover${className ? ` ${className}` : ''}`}
      style={position ? { top: position.top, left: position.left } : { top: -9999, left: -9999 }}
    >
      {children}
    </div>,
    document.body,
  )
}

export interface MenuItem {
  id: string
  label: string
  icon?: UiIconName
  shortcut?: string
  disabled?: boolean
  danger?: boolean
  /** Starts a new visual group. */
  separatorBefore?: boolean
  onSelect: () => void
}

interface MenuButtonProps {
  label: string
  items: MenuItem[]
  children: ReactNode
  className?: string
  placement?: Placement
  disabled?: boolean
  title?: string
  onOpenChange?: (open: boolean) => void
}

/** A button that opens a menu (WAI-ARIA menu button pattern). */
export function MenuButton({ label, items, children, className = 'v2-icon-button', placement = 'bottom-end', disabled, title, onOpenChange }: MenuButtonProps) {
  const [open, setOpen] = useState(false)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const setMenuOpen = (next: boolean) => {
    setOpen(next)
    onOpenChange?.(next)
  }
  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        className={className}
        aria-label={label}
        title={title ?? label}
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={disabled}
        onClick={(event) => {
          event.stopPropagation()
          setMenuOpen(!open)
        }}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' && !open) {
            event.preventDefault()
            setMenuOpen(true)
          }
        }}
      >
        {children}
      </button>
      <Menu
        anchorRef={buttonRef}
        open={open}
        label={label}
        items={items}
        placement={placement}
        onClose={(reason) => {
          setMenuOpen(false)
          if (reason !== 'outside') buttonRef.current?.focus()
        }}
      />
    </>
  )
}

interface MenuProps {
  anchorRef: RefObject<HTMLElement | null>
  open: boolean
  label: string
  items: MenuItem[]
  placement?: Placement
  onClose: (reason: 'escape' | 'outside' | 'select') => void
}

export function Menu({ anchorRef, open, label, items, placement, onClose }: MenuProps) {
  const listRef = useRef<HTMLDivElement>(null)
  const enabled = items.filter((item) => !item.disabled)
  const [active, setActive] = useState(0)

  useEffect(() => {
    if (!open) return
    setActive(0)
    const frame = requestAnimationFrame(() => listRef.current?.querySelector<HTMLElement>('[role="menuitem"]:not([aria-disabled="true"])')?.focus())
    return () => cancelAnimationFrame(frame)
  }, [open])

  const focusItem = (index: number) => {
    const nodes = listRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:not([aria-disabled="true"])')
    if (!nodes?.length) return
    const next = (index + nodes.length) % nodes.length
    setActive(next)
    nodes[next].focus()
  }

  return (
    <Popover anchorRef={anchorRef} open={open} onClose={onClose} placement={placement} role="presentation" className="v2-menu-surface">
      <div
        ref={listRef}
        role="menu"
        aria-label={label}
        className="v2-menu"
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown') { event.preventDefault(); focusItem(active + 1) }
          else if (event.key === 'ArrowUp') { event.preventDefault(); focusItem(active - 1) }
          else if (event.key === 'Home') { event.preventDefault(); focusItem(0) }
          else if (event.key === 'End') { event.preventDefault(); focusItem(enabled.length - 1) }
          else if (event.key === 'Tab') onClose('outside')
        }}
      >
        {items.map((item) => (
          <div key={item.id} role="none">
            {item.separatorBefore && <div className="v2-menu__separator" role="separator" />}
            <button
              type="button"
              role="menuitem"
              className={`v2-menu__item${item.danger ? ' v2-menu__item--danger' : ''}`}
              aria-disabled={item.disabled || undefined}
              tabIndex={-1}
              onClick={(event) => {
                event.stopPropagation()
                if (item.disabled) return
                onClose('select')
                item.onSelect()
              }}
            >
              {item.icon ? <Icon name={item.icon} /> : <span className="v2-icon" aria-hidden="true" />}
              <span className="v2-menu__label">{item.label}</span>
              {item.shortcut && <kbd className="v2-menu__shortcut">{item.shortcut}</kbd>}
            </button>
          </div>
        ))}
      </div>
    </Popover>
  )
}
