import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'

import { createIcon, iconNames } from '../../catalog/icons'
import { colorRoles, isHexColor } from '../../catalog/tokens'
import { isSafeImageUrl } from '../../render/urls'
import { gradientPresets } from '../../render/theme'
import Icon from '../common/Icon'
import { Popover } from '../common/Popover'
import { humanize, newListItem, type FieldDef } from './fieldModel'

/**
 * Form controls for the schema-driven Design panel. Every control keeps a
 * local draft and commits once (Enter or blur for text, immediately for
 * choices), so each change is one undo step. A commit returns an error
 * message when validation rejects it; the control shows it and keeps the draft.
 */

export type Commit = (value: unknown) => string | null

interface FieldProps {
  field: FieldDef
  value: unknown
  disabled?: boolean
  onCommit: Commit
}

function useDraft<T>(value: T): [T, (next: T) => void, boolean, (focused: boolean) => void] {
  const [draft, setDraft] = useState(value)
  const [focused, setFocused] = useState(false)
  useEffect(() => {
    if (!focused) setDraft(value)
  }, [value, focused])
  return [draft, setDraft, focused, setFocused]
}

export function FieldShell({ field, id, error, children, inline }: { field: Pick<FieldDef, 'label' | 'required'>; id: string; error?: string | null; children: ReactNode; inline?: boolean }) {
  return (
    <div className={`v2-field-row${inline ? ' v2-field-row--inline' : ''}${error ? ' v2-field-row--error' : ''}`}>
      <label className="v2-field-row__label" htmlFor={id}>{field.label}{field.required ? <span className="v2-required" aria-hidden="true"> *</span> : null}</label>
      <div className="v2-field-row__control">{children}</div>
      {error && <p className="v2-field-row__error" role="alert">{error}</p>}
    </div>
  )
}

const richActions: Array<{ label: string; icon: 'bold' | 'italic' | 'highlighter' | 'code' | 'strikethrough' | 'link'; before: string; after: string; key?: string }> = [
  { label: 'Bold', icon: 'bold', before: '**', after: '**', key: 'b' },
  { label: 'Italic', icon: 'italic', before: '*', after: '*', key: 'i' },
  { label: 'Accent highlight', icon: 'highlighter', before: '==', after: '==', key: 'e' },
  { label: 'Code', icon: 'code', before: '`', after: '`' },
  { label: 'Strikethrough', icon: 'strikethrough', before: '~~', after: '~~' },
  { label: 'Link', icon: 'link', before: '[', after: '](https://)', key: 'k' },
]

/** Wraps the textarea selection in rich-text markers and keeps it selected. */
export function wrapSelection(element: HTMLTextAreaElement | HTMLInputElement, before: string, after: string, update: (value: string) => void): void {
  const start = element.selectionStart ?? element.value.length
  const end = element.selectionEnd ?? start
  const selected = element.value.slice(start, end) || 'text'
  const next = `${element.value.slice(0, start)}${before}${selected}${after}${element.value.slice(end)}`
  update(next)
  requestAnimationFrame(() => {
    element.focus()
    element.setSelectionRange(start + before.length, start + before.length + selected.length)
  })
}

export function TextField({ field, value, disabled, onCommit }: FieldProps) {
  const id = useId()
  const current = typeof value === 'string' ? value : value === undefined || value === null ? '' : String(value)
  const [draft, setDraft, , setFocused] = useDraft(current)
  const [error, setError] = useState<string | null>(null)
  const ref = useRef<HTMLTextAreaElement & HTMLInputElement>(null)

  const commit = () => {
    if (draft === current) return
    const next = draft.trim() === '' && !field.required ? null : draft
    const problem = onCommit(next)
    setError(problem)
  }
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      setDraft(current)
      setError(null)
      event.currentTarget.blur()
    } else if (event.key === 'Enter' && (!field.multiline || event.metaKey || event.ctrlKey) && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault()
      commit()
    } else if (field.rich && (event.metaKey || event.ctrlKey)) {
      const action = richActions.find((candidate) => candidate.key === event.key.toLowerCase())
      if (action && ref.current) {
        event.preventDefault()
        wrapSelection(ref.current, action.before, action.after, setDraft)
      }
    }
  }
  const common = {
    id,
    ref,
    className: `v2-input${field.mono ? ' v2-input--mono' : ''}`,
    value: draft,
    disabled,
    maxLength: field.maxLength,
    spellCheck: !field.mono,
    'aria-invalid': error ? true : undefined,
    onChange: (event: { target: { value: string } }) => setDraft(event.target.value),
    onFocus: () => setFocused(true),
    onBlur: () => { setFocused(false); commit() },
    onKeyDown,
  }
  return (
    <FieldShell field={field} id={id} error={error}>
      {field.rich && (
        <div className="v2-richbar" role="toolbar" aria-label={`Format ${field.label}`}>
          {richActions.map((action) => (
            <button
              key={action.label}
              type="button"
              className="v2-richbar__button"
              title={`${action.label}${action.key ? ` (Ctrl/⌘+${action.key.toUpperCase()})` : ''}`}
              aria-label={action.label}
              disabled={disabled}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => { if (ref.current) wrapSelection(ref.current, action.before, action.after, setDraft) }}
            >
              <Icon name={action.icon} size={14} />
            </button>
          ))}
        </div>
      )}
      {field.multiline || field.rich ? <textarea rows={field.mono ? 8 : Math.min(8, Math.max(2, Math.ceil(draft.length / 38)))} {...common} /> : <input type="text" {...common} />}
    </FieldShell>
  )
}

export function NumberField({ field, value, disabled, onCommit }: FieldProps) {
  const id = useId()
  const current = typeof value === 'number' ? String(value) : ''
  const [draft, setDraft, , setFocused] = useDraft(current)
  const [error, setError] = useState<string | null>(null)
  const commit = () => {
    if (draft === current) return
    if (draft.trim() === '') {
      setError(field.required ? 'A number is required.' : onCommit(null))
      return
    }
    const number = Number(draft)
    if (!Number.isFinite(number)) {
      setError('Enter a number.')
      return
    }
    setError(onCommit(field.step === 1 ? Math.round(number) : number))
  }
  return (
    <FieldShell field={field} id={id} error={error}>
      <input
        id={id}
        type="number"
        className="v2-input"
        value={draft}
        min={field.min}
        max={field.max}
        step={field.step ?? 'any'}
        disabled={disabled}
        placeholder={field.required ? undefined : 'Auto'}
        onChange={(event) => setDraft(event.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => { setFocused(false); commit() }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') { event.preventDefault(); commit() }
          if (event.key === 'Escape') { event.stopPropagation(); setDraft(current); setError(null) }
        }}
      />
    </FieldShell>
  )
}

export function BooleanField({ field, value, disabled, onCommit }: FieldProps) {
  const id = useId()
  const [error, setError] = useState<string | null>(null)
  return (
    <FieldShell field={field} id={id} error={error} inline>
      <input
        id={id}
        type="checkbox"
        role="switch"
        className="v2-switch-input"
        checked={value === true}
        disabled={disabled}
        onChange={(event) => setError(onCommit(event.target.checked ? true : field.required ? false : null))}
      />
    </FieldShell>
  )
}

function optionLabel(option: string | number): string {
  return typeof option === 'number' ? String(option) : option.replace(/-/g, ' ')
}

export function EnumField({ field, value, disabled, onCommit }: FieldProps) {
  const id = useId()
  const [error, setError] = useState<string | null>(null)
  const options = field.options ?? []
  const segmented = options.length <= 4 && options.every((option) => optionLabel(option).length <= 10)
  const choose = (next: string | number | null) => setError(onCommit(next))
  if (segmented) {
    return (
      <FieldShell field={field} id={id} error={error}>
        <div className="v2-seg" role="radiogroup" aria-labelledby={`${id}-label`} id={id}>
          <span id={`${id}-label`} className="v2-visually-hidden">{field.label}</span>
          {!field.required && (
            <button type="button" role="radio" aria-checked={value === undefined} className="v2-seg__option" disabled={disabled} onClick={() => value !== undefined && choose(null)}>Auto</button>
          )}
          {options.map((option) => (
            <button key={String(option)} type="button" role="radio" aria-checked={value === option} className="v2-seg__option" disabled={disabled} onClick={() => value !== option && choose(option)}>
              {optionLabel(option)}
            </button>
          ))}
        </div>
      </FieldShell>
    )
  }
  return (
    <FieldShell field={field} id={id} error={error}>
      <select
        id={id}
        className="v2-input v2-select"
        value={value === undefined ? '' : String(value)}
        disabled={disabled}
        onChange={(event) => {
          const raw = event.target.value
          if (raw === '') return choose(null)
          const option = options.find((candidate) => String(candidate) === raw)
          choose(option ?? raw)
        }}
      >
        {!field.required && <option value="">Auto</option>}
        {options.map((option) => <option key={String(option)} value={String(option)}>{optionLabel(option)}</option>)}
      </select>
    </FieldShell>
  )
}

/** Unions of words and numbers (grid columns: 3 or "2fr 1fr"; spacer size: md or flex). */
export function LooseField({ field, value, disabled, onCommit }: FieldProps) {
  const id = useId()
  const listId = useId()
  const current = value === undefined || value === null ? '' : String(value)
  const [draft, setDraft, , setFocused] = useDraft(current)
  const [error, setError] = useState<string | null>(null)
  const commit = () => {
    if (draft === current) return
    const trimmed = draft.trim()
    if (!trimmed) return setError(field.required ? 'A value is required.' : onCommit(null))
    setError(onCommit(/^\d+$/.test(trimmed) ? Number(trimmed) : trimmed))
  }
  return (
    <FieldShell field={field} id={id} error={error}>
      <input
        id={id}
        className="v2-input"
        list={field.options ? listId : undefined}
        value={draft}
        disabled={disabled}
        placeholder={field.key === 'columns' ? 'Auto, 3 or 2fr 1fr' : 'Auto'}
        onChange={(event) => setDraft(event.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => { setFocused(false); commit() }}
        onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); commit() } }}
      />
      {field.options && <datalist id={listId}>{field.options.map((option) => <option key={String(option)} value={String(option)} />)}</datalist>}
    </FieldShell>
  )
}

export function ColorField({ field, value, disabled, onCommit }: FieldProps) {
  const id = useId()
  const [error, setError] = useState<string | null>(null)
  const current = typeof value === 'string' ? value : ''
  const custom = isHexColor(current)
  const [hex, setHex] = useState(custom ? current : '#7c6cf0')
  useEffect(() => { if (custom) setHex(current) }, [current, custom])
  const choose = (next: string | null) => setError(onCommit(next))
  return (
    <FieldShell field={field} id={id} error={error}>
      <div className="v2-color">
        <select
          id={id}
          className="v2-input v2-select"
          value={custom ? '__custom' : current}
          disabled={disabled}
          onChange={(event) => {
            const raw = event.target.value
            if (raw === '__custom') choose(hex)
            else choose(raw || null)
          }}
        >
          {!field.required && <option value="">Theme default</option>}
          {colorRoles.map((role) => <option key={role} value={role}>{role}</option>)}
          <option value="__custom">Custom…</option>
        </select>
        {custom && (
          <>
            <input type="color" className="v2-color__swatch" aria-label={`${field.label} color`} value={hex.length === 4 ? `#${hex[1]}${hex[1]}${hex[2]}${hex[2]}${hex[3]}${hex[3]}` : hex} disabled={disabled} onChange={(event) => setHex(event.target.value)} onBlur={() => hex !== current && choose(hex)} />
            <input
              className="v2-input v2-input--mono v2-color__hex"
              aria-label={`${field.label} hex value`}
              value={hex}
              disabled={disabled}
              onChange={(event) => setHex(event.target.value)}
              onBlur={() => { if (hex !== current) choose(isHexColor(hex) ? hex : current) }}
              onKeyDown={(event) => { if (event.key === 'Enter' && isHexColor(hex)) choose(hex) }}
            />
          </>
        )}
      </div>
    </FieldShell>
  )
}

function IconPreview({ name }: { name: string }) {
  const ref = useRef<HTMLSpanElement>(null)
  useEffect(() => {
    ref.current?.replaceChildren(createIcon(document, name, 'v2-icon'))
  }, [name])
  return <span ref={ref} className="v2-icon-preview" aria-hidden="true" />
}

export function IconField({ field, value, disabled, onCommit }: FieldProps) {
  const id = useId()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [error, setError] = useState<string | null>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const current = typeof value === 'string' ? value : ''
  const matches = useMemo(() => iconNames.filter((name) => name.includes(query.trim().toLowerCase())), [query])
  const choose = (next: string | null) => {
    setOpen(false)
    setError(onCommit(next))
  }
  return (
    <FieldShell field={field} id={id} error={error}>
      <button ref={buttonRef} id={id} type="button" className="v2-input v2-iconpick" disabled={disabled} aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen(!open)}>
        {current ? <IconPreview name={current} /> : null}
        <span>{current || 'None'}</span>
        <Icon name="chevron-down" size={14} />
      </button>
      <Popover anchorRef={buttonRef} open={open} onClose={() => setOpen(false)} className="v2-iconpick__popover" label="Choose an icon">
        <input className="v2-input" type="search" placeholder="Search icons…" aria-label="Search icons" value={query} autoFocus onChange={(event) => setQuery(event.target.value)} />
        <div className="v2-iconpick__grid" role="listbox" aria-label="Icons">
          {!field.required && <button type="button" role="option" aria-selected={!current} className="v2-iconpick__option" onClick={() => choose(null)} title="No icon"><Icon name="x" /></button>}
          {matches.map((name) => (
            <button key={name} type="button" role="option" aria-selected={name === current} className="v2-iconpick__option" title={name} aria-label={name} onClick={() => choose(name)}>
              <IconPreview name={name} />
            </button>
          ))}
        </div>
      </Popover>
    </FieldShell>
  )
}

export function UrlField({ field, value, disabled, onCommit }: FieldProps) {
  const id = useId()
  const current = typeof value === 'string' ? value : ''
  const [draft, setDraft, , setFocused] = useDraft(current)
  const [error, setError] = useState<string | null>(null)
  const commit = () => {
    if (draft === current) return
    const trimmed = draft.trim()
    if (!trimmed) return setError(field.required ? 'A URL is required.' : onCommit(null))
    if (field.key !== 'url' && !isSafeImageUrl(trimmed)) return setError('Use an https:// image URL (or a same-site /path).')
    setError(onCommit(trimmed))
  }
  const preview = field.key !== 'url' && field.key !== 'src' ? null : field.key === 'src' && isSafeImageUrl(current) && !/\.(mp4|webm)(\?|#|$)/i.test(current) ? current : null
  return (
    <FieldShell field={field} id={id} error={error}>
      <div className="v2-url">
        {preview && <img className="v2-url__preview" src={preview} alt="" referrerPolicy="no-referrer" />}
        <input
          id={id}
          type="url"
          className="v2-input v2-input--mono"
          value={draft}
          disabled={disabled}
          placeholder="https://…"
          onChange={(event) => setDraft(event.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => { setFocused(false); commit() }}
          onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); commit() } }}
        />
      </div>
    </FieldShell>
  )
}

function ListControls({ index, count, min, disabled, onMove, onRemove, label }: { index: number; count: number; min: number; disabled?: boolean; onMove: (delta: -1 | 1) => void; onRemove: () => void; label: string }) {
  return (
    <span className="v2-listctl">
      <button type="button" className="v2-mini" aria-label={`Move ${label} up`} disabled={disabled || index === 0} onClick={() => onMove(-1)}><Icon name="arrow-up" size={13} /></button>
      <button type="button" className="v2-mini" aria-label={`Move ${label} down`} disabled={disabled || index === count - 1} onClick={() => onMove(1)}><Icon name="arrow-down" size={13} /></button>
      <button type="button" className="v2-mini v2-mini--danger" aria-label={`Remove ${label}`} disabled={disabled || count <= min} onClick={onRemove}><Icon name="x" size={13} /></button>
    </span>
  )
}

function moved<T>(items: readonly T[], index: number, delta: -1 | 1): T[] {
  const next = [...items]
  const [item] = next.splice(index, 1)
  next.splice(index + delta, 0, item)
  return next
}

export function StringListField({ field, value, disabled, onCommit }: FieldProps) {
  const id = useId()
  const items = Array.isArray(value) ? value.map(String) : []
  const [error, setError] = useState<string | null>(null)
  const commit = (next: string[]) => setError(onCommit(next))
  return (
    <FieldShell field={field} id={id} error={error}>
      <ol className="v2-strlist" id={id}>
        {items.map((item, index) => (
          <li key={`${index}-${items.length}`}>
            <StringListItem value={item} label={`${field.label} ${index + 1}`} disabled={disabled} maxLength={field.maxLength} onCommit={(next) => commit(items.map((entry, position) => (position === index ? next : entry)))} />
            <ListControls index={index} count={items.length} min={field.minItems ?? 0} disabled={disabled} label={`item ${index + 1}`} onMove={(delta) => commit(moved(items, index, delta))} onRemove={() => commit(items.filter((_, position) => position !== index))} />
          </li>
        ))}
      </ol>
      <button type="button" className="v2-button v2-button--ghost v2-button--sm" disabled={disabled || items.length >= (field.maxItems ?? Infinity)} onClick={() => commit([...items, `Item ${items.length + 1}`])}><Icon name="plus" size={14} />Add</button>
    </FieldShell>
  )
}

function StringListItem({ value, label, disabled, maxLength, onCommit }: { value: string; label: string; disabled?: boolean; maxLength?: number; onCommit: (value: string) => void }) {
  const [draft, setDraft, , setFocused] = useDraft(value)
  const commit = () => { if (draft !== value && draft.trim()) onCommit(draft) }
  return (
    <input
      className="v2-input"
      aria-label={label}
      value={draft}
      maxLength={maxLength}
      disabled={disabled}
      onChange={(event) => setDraft(event.target.value)}
      onFocus={() => setFocused(true)}
      onBlur={() => { setFocused(false); commit() }}
      onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); commit() } }}
    />
  )
}

function itemSummary(item: unknown, index: number): string {
  if (typeof item === 'string') return item
  if (item && typeof item === 'object') {
    const record = item as Record<string, unknown>
    for (const key of ['title', 'text', 'label', 'name', 'header']) if (typeof record[key] === 'string' && record[key]) return record[key] as string
  }
  return `Item ${index + 1}`
}

export function ObjectListField({ field, value, disabled, onCommit }: FieldProps) {
  const id = useId()
  const items = Array.isArray(value) ? value : []
  const [error, setError] = useState<string | null>(null)
  const [openIndex, setOpenIndex] = useState<number | null>(null)
  const commit = (next: unknown[]) => {
    const problem = onCommit(next)
    setError(problem)
    return problem
  }
  const itemField: FieldDef = { ...field, kind: 'object', label: 'Item', required: true }
  return (
    <FieldShell field={field} id={id} error={error}>
      <ol className="v2-objlist" id={id}>
        {items.map((item, index) => {
          const open = openIndex === index
          return (
            <li key={index} className={`v2-objlist__item${open ? ' v2-objlist__item--open' : ''}`}>
              <div className="v2-objlist__head">
                <button type="button" className="v2-objlist__toggle" aria-expanded={open} onClick={() => setOpenIndex(open ? null : index)}>
                  <Icon name={open ? 'chevron-down' : 'chevron-right'} size={14} />
                  <span className="v2-objlist__index">{index + 1}</span>
                  <span className="v2-objlist__summary">{itemSummary(item, index)}</span>
                </button>
                <ListControls index={index} count={items.length} min={field.minItems ?? 0} disabled={disabled} label={`item ${index + 1}`} onMove={(delta) => { commit(moved(items, index, delta)); setOpenIndex(null) }} onRemove={() => { commit(items.filter((_, position) => position !== index)); setOpenIndex(null) }} />
              </div>
              {open && (
                <div className="v2-objlist__body">
                  <ObjectFields
                    field={itemField}
                    value={typeof item === 'string' ? { text: item } : item}
                    disabled={disabled}
                    onCommit={(next) => {
                      const record = (next ?? {}) as Record<string, unknown>
                      const keys = Object.keys(record)
                      const stored = field.itemMayBeString && keys.length === 1 && keys[0] === 'text' ? record.text : record
                      return commit(items.map((entry, position) => (position === index ? stored : entry)))
                    }}
                  />
                </div>
              )}
            </li>
          )
        })}
      </ol>
      <button type="button" className="v2-button v2-button--ghost v2-button--sm" disabled={disabled || items.length >= (field.maxItems ?? Infinity)} onClick={() => { if (!commit([...items, newListItem(field, items.length)])) setOpenIndex(items.length) }}><Icon name="plus" size={14} />Add item</button>
    </FieldShell>
  )
}

/** Nested fields of an object; each nested commit rebuilds the object. */
export function ObjectFields({ field, value, disabled, onCommit }: FieldProps) {
  const record = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
  return (
    <div className="v2-fields">
      {(field.fields ?? []).map((nested) => (
        <FieldControl
          key={nested.key}
          field={nested}
          value={record[nested.key]}
          disabled={disabled}
          onCommit={(next) => {
            const updated = { ...record }
            if (next === null || next === undefined) delete updated[nested.key]
            else updated[nested.key] = next
            return onCommit(Object.keys(updated).length ? updated : field.required ? updated : null)
          }}
        />
      ))}
    </div>
  )
}

export function ObjectField(props: FieldProps) {
  return (
    <fieldset className="v2-fieldset">
      <legend>{props.field.label}</legend>
      <ObjectFields {...props} />
    </fieldset>
  )
}

export function GradientField({ field, value, disabled, onCommit }: FieldProps) {
  const id = useId()
  const [error, setError] = useState<string | null>(null)
  const custom = Boolean(value && typeof value === 'object')
  const record = custom ? value as Record<string, unknown> : null
  const choose = (next: unknown) => setError(onCommit(next))
  return (
    <FieldShell field={field} id={id} error={error}>
      <select
        id={id}
        className="v2-input v2-select"
        value={custom ? '__custom' : typeof value === 'string' ? value : ''}
        disabled={disabled}
        onChange={(event) => {
          const raw = event.target.value
          if (raw === '__custom') choose({ from: 'accent', to: 'accent2', angle: 135 })
          else choose(raw || null)
        }}
      >
        <option value="">None</option>
        {gradientPresets.map((preset) => <option key={preset} value={preset}>{preset}</option>)}
        <option value="__custom">Custom…</option>
      </select>
      {record && (
        <ObjectFields
          field={{ ...field, required: true, fields: [
            { key: 'from', label: 'From', kind: 'color', group: 'style', required: true, schema: {} },
            { key: 'to', label: 'To', kind: 'color', group: 'style', required: true, schema: {} },
            { key: 'angle', label: 'Angle', kind: 'number', group: 'style', required: false, schema: {}, min: 0, max: 360, step: 1 },
            { key: 'kind', label: 'Kind', kind: 'enum', group: 'style', required: false, schema: {}, options: ['linear', 'radial'] },
          ] }}
          value={record}
          disabled={disabled}
          onCommit={(next) => { const problem = onCommit(next); setError(problem); return problem }}
        />
      )}
    </FieldShell>
  )
}

export function JsonField({ field, value, disabled, onCommit }: FieldProps) {
  const id = useId()
  const current = value === undefined ? '' : JSON.stringify(value, null, 2)
  const [draft, setDraft, , setFocused] = useDraft(current)
  const [error, setError] = useState<string | null>(null)
  const commit = () => {
    if (draft === current) return
    if (!draft.trim()) return setError(field.required ? 'A value is required.' : onCommit(null))
    try {
      setError(onCommit(JSON.parse(draft)))
    } catch (cause) {
      setError(`Invalid JSON: ${String(cause).replace(/^SyntaxError: /, '')}`)
    }
  }
  return (
    <FieldShell field={field} id={id} error={error}>
      <textarea id={id} className="v2-input v2-input--mono" rows={4} spellCheck={false} value={draft} disabled={disabled} onChange={(event) => setDraft(event.target.value)} onFocus={() => setFocused(true)} onBlur={() => { setFocused(false); commit() }} />
    </FieldShell>
  )
}

export function FieldControl(props: FieldProps) {
  switch (props.field.kind) {
    case 'text': return <TextField {...props} />
    case 'number': return <NumberField {...props} />
    case 'boolean': return <BooleanField {...props} />
    case 'enum': return <EnumField {...props} />
    case 'loose': return <LooseField {...props} />
    case 'color': return <ColorField {...props} />
    case 'icon': return <IconField {...props} />
    case 'url': return <UrlField {...props} />
    case 'string-list': return <StringListField {...props} />
    case 'object-list': return <ObjectListField {...props} />
    case 'object': return <ObjectField {...props} />
    case 'gradient': return <GradientField {...props} />
    default: return <JsonField {...props} />
  }
}

export { humanize }
