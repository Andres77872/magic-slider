import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { z } from 'zod'

import { getPrimitive } from '../../catalog/registry'
import type { Block } from '../../catalog/types'
import { slideShape, type Deck, type Slide } from '../../domain/deckSchema'
import type { DeckDiagnostic } from '../../domain/normalize'
import { locateBlock } from '../../domain/tree'
import Icon, { primitiveIcons, type UiIconName } from '../common/Icon'
import { ChartDataEditor, TableEditor } from './DataEditors'
import DeckPanel from './DeckPanel'
import { FieldControl, ObjectListField, TextField } from './fields'
import { blockFields, groupFields, groupTitles, objectFields, toJsonSchema, type FieldDef, type FieldGroup } from './fieldModel'
import LayersPanel, { type LayerAction } from './LayersPanel'

export type InspectorTab = 'design' | 'layers' | 'notes' | 'theme' | 'json' | 'issues'

interface InspectorProps {
  deck: Deck
  slide: Slide | null
  slideIndex: number
  selectedBlockId: string | null
  diagnostics: DeckDiagnostic[]
  fitScale?: number
  disabled?: boolean
  tab: InspectorTab
  onTabChange: (tab: InspectorTab) => void
  onSelectBlock: (blockId: string | null) => void
  onSetBlock: (blockId: string, set: Record<string, unknown>) => string | null
  onSetSlide: (slideId: string, set: Record<string, unknown>) => string | null
  onSetDeck: (set: Record<string, unknown>, summary: string) => string | null
  onBlockAction: (action: LayerAction, blockId: string) => void
  onSlideAction: (action: 'duplicate' | 'delete' | 'reference', slideId: string) => void
  onReplaceBlockJson: (blockId: string, json: string) => string | null
  onReplaceDeck: (json: string) => string | null
}

const customEditors: Record<string, string[]> = { chart: ['labels', 'series'], table: ['columns', 'rows'] }
const slideFieldDefs = (): FieldDef[] => objectFields(toJsonSchema(z.strictObject(slideShape)), null)
  .filter((field) => !['id', 'notes', 'sources'].includes(field.key))
  .map((field) => ({ ...field, group: (field.key === 'name' ? 'content' : field.key === 'background' || field.key === 'tone' ? 'style' : field.group) as FieldGroup }))

function JsonEditor({ value, onApply, applyLabel, disabled, label }: { value: string; onApply: (text: string) => string | null; applyLabel: string; disabled?: boolean; label: string }) {
  const [draft, setDraft] = useState(value)
  const [base, setBase] = useState(value)
  const [error, setError] = useState<string | null>(null)
  // Follow outside changes only while the draft is untouched, so edits in progress survive.
  useEffect(() => {
    if (draft === base) {
      setDraft(value)
      setBase(value)
      setError(null)
    }
  }, [value])
  const dirty = draft !== value
  const stale = base !== value && draft !== base
  return (
    <div className="v2-json">
      <textarea className="v2-json__input" spellCheck={false} value={draft} onChange={(event) => setDraft(event.target.value)} disabled={disabled} aria-label={label} />
      {error && <p className="v2-json__error" role="alert">{error}</p>}
      {stale && !error && <p className="v2-json__error" role="status">The presentation changed since you started editing. Apply to overwrite it, or Reset to load the latest version.</p>}
      <div className="v2-json__actions">
        <button type="button" className="v2-button v2-button--ghost v2-button--sm" disabled={!dirty && !stale} onClick={() => { setDraft(value); setBase(value); setError(null) }}>Reset</button>
        <button
          type="button"
          className="v2-button v2-button--primary v2-button--sm"
          disabled={!dirty || disabled}
          onClick={() => {
            const problem = onApply(draft)
            setError(problem)
            if (!problem) setBase(draft)
          }}
        >
          {applyLabel}
        </button>
      </div>
    </div>
  )
}

function Section({ title, children, defaultOpen = true }: { title: string; children: ReactNode; defaultOpen?: boolean }) {
  return (
    <details className="v2-section v2-section--collapsible" open={defaultOpen}>
      <summary className="v2-section__title"><Icon name="chevron-right" size={13} className="v2-section__chevron" />{title}</summary>
      <div className="v2-fields">{children}</div>
    </details>
  )
}

function Breadcrumb({ slide, slideIndex, trail, onSelect }: { slide: Slide; slideIndex: number; trail: Block[]; onSelect: (id: string | null) => void }) {
  return (
    <nav className="v2-crumbs" aria-label="Selection path">
      <ol>
        <li><button type="button" className="v2-crumbs__item" onClick={() => onSelect(null)}><Icon name="layers" size={12} />Slide {slideIndex + 1}{slide.name ? ` · ${slide.name}` : ''}</button></li>
        {trail.map((block, index) => (
          <li key={block.id}>
            <Icon name="chevron-right" size={12} className="v2-crumbs__sep" />
            <button type="button" className="v2-crumbs__item" aria-current={index === trail.length - 1 ? 'true' : undefined} onClick={() => onSelect(block.id ?? null)}>
              <Icon name={primitiveIcons[block.type] ?? 'square'} size={12} />{block.type}
            </button>
          </li>
        ))}
      </ol>
    </nav>
  )
}

function ActionButton({ icon, label, onClick, disabled, danger }: { icon: UiIconName; label: string; onClick: () => void; disabled?: boolean; danger?: boolean }) {
  return (
    <button type="button" className={`v2-button v2-button--ghost v2-button--sm${danger ? ' v2-button--danger' : ''}`} disabled={disabled} onClick={onClick}><Icon name={icon} size={14} />{label}</button>
  )
}

function BlockDesign({ deck, block, disabled, onSetBlock, onBlockAction, onReplaceBlockJson }: Pick<InspectorProps, 'deck' | 'disabled' | 'onSetBlock' | 'onBlockAction' | 'onReplaceBlockJson'> & { block: Block }) {
  const primitive = getPrimitive(block.type)
  const custom = customEditors[block.type] ?? []
  const fields = useMemo(() => blockFields(block.type).filter((field) => !custom.includes(field.key)), [block.type])
  const id = block.id!
  const set = (key: string) => (value: unknown) => onSetBlock(id, { [key]: value === undefined ? null : value })
  const blockJson = JSON.stringify(block, null, 2)
  void deck
  return (
    <>
      <header className="v2-inspector__header">
        <span className="v2-inspector__icon"><Icon name={primitiveIcons[block.type] ?? 'square'} size={18} /></span>
        <div>
          <strong>{block.type}</strong>
          <code title="Id used in chat as @id">@{id}</code>
        </div>
      </header>
      {primitive && <p className="v2-muted v2-small v2-inspector__summary">{primitive.summary}</p>}
      <div className="v2-inspector__actions">
        <ActionButton icon="at-sign" label="Ask AI" onClick={() => onBlockAction('reference', id)} />
        <ActionButton icon="duplicate" label="Duplicate" disabled={disabled} onClick={() => onBlockAction('duplicate', id)} />
        <ActionButton icon="trash" label="Delete" danger disabled={disabled} onClick={() => onBlockAction('delete', id)} />
      </div>
      {groupFields(fields).map(({ group, fields: groupItems }) => (
        <Section key={group} title={groupTitles[group]} defaultOpen={group !== 'animation'}>
          {group === 'content' && block.type === 'chart' && <ChartDataEditor block={block} disabled={disabled} onSet={(values) => onSetBlock(id, values)} />}
          {group === 'content' && block.type === 'table' && <TableEditor block={block} disabled={disabled} onSet={(values) => onSetBlock(id, values)} />}
          {groupItems.map((field) => <FieldControl key={`${id}-${field.key}`} field={field} value={block[field.key]} disabled={disabled} onCommit={set(field.key)} />)}
        </Section>
      ))}
      <Section title="JSON" defaultOpen={false}>
        <JsonEditor
          key={id}
          value={blockJson}
          label="Block JSON"
          applyLabel="Apply"
          disabled={disabled}
          onApply={(text) => onReplaceBlockJson(id, text)}
        />
      </Section>
    </>
  )
}

function SlideDesign({ deck, slide, slideIndex, fitScale, disabled, onSetSlide, onSlideAction }: Pick<InspectorProps, 'deck' | 'fitScale' | 'disabled' | 'onSetSlide' | 'onSlideAction'> & { slide: Slide; slideIndex: number }) {
  const fields = useMemo(slideFieldDefs, [])
  const set = (key: string) => (value: unknown) => onSetSlide(slide.id, { [key]: value === undefined ? null : value })
  return (
    <>
      <header className="v2-inspector__header">
        <span className="v2-inspector__icon"><Icon name="layers" size={18} /></span>
        <div>
          <strong>Slide {slideIndex + 1}</strong>
          <code title="Id used in chat as @id">@{slide.id}</code>
        </div>
      </header>
      {fitScale !== undefined && fitScale < 0.97 && (
        <p className="v2-note v2-note--warning"><Icon name="warning" size={14} />Content is scaled to {Math.round(fitScale * 100)}% to fit. Shorten the text or split the slide.</p>
      )}
      <div className="v2-inspector__actions">
        <ActionButton icon="at-sign" label="Ask AI" onClick={() => onSlideAction('reference', slide.id)} />
        <ActionButton icon="duplicate" label="Duplicate" disabled={disabled} onClick={() => onSlideAction('duplicate', slide.id)} />
        <ActionButton icon="trash" label="Delete" danger disabled={disabled || deck.slides.length <= 1} onClick={() => onSlideAction('delete', slide.id)} />
      </div>
      {groupFields(fields).map(({ group, fields: groupItems }) => (
        <Section key={group} title={groupTitles[group]} defaultOpen={group !== 'animation'}>
          {groupItems.map((field) => <FieldControl key={`${slide.id}-${field.key}`} field={field} value={slide[field.key as keyof Slide]} disabled={disabled} onCommit={set(field.key)} />)}
        </Section>
      ))}
      <p className="v2-muted v2-small">Select an element on the canvas to edit it. Speaker notes and sources are in the Notes tab.</p>
    </>
  )
}

function NotesPanel({ slide, disabled, onSetSlide }: { slide: Slide; disabled?: boolean; onSetSlide: InspectorProps['onSetSlide'] }) {
  const sourcesField = useMemo(() => objectFields(toJsonSchema(z.strictObject(slideShape)), null).find((field) => field.key === 'sources')!, [])
  return (
    <div className="v2-fields">
      <TextField
        key={`${slide.id}-notes`}
        field={{ key: 'notes', label: 'Speaker notes', kind: 'text', group: 'content', required: false, schema: {}, multiline: true, maxLength: 5_000 }}
        value={slide.notes}
        disabled={disabled}
        onCommit={(value) => onSetSlide(slide.id, { notes: value })}
      />
      <ObjectListField key={`${slide.id}-sources`} field={{ ...sourcesField, label: 'Sources' }} value={slide.sources ?? []} disabled={disabled} onCommit={(value) => onSetSlide(slide.id, { sources: Array.isArray(value) && value.length ? value : null })} />
      <p className="v2-muted v2-small">Notes show in the presenter view and the exported file. Sources print in the slide footer.</p>
    </div>
  )
}

export default function Inspector(props: InspectorProps) {
  const { deck, slide, slideIndex, selectedBlockId, diagnostics, disabled, tab, onTabChange, onSelectBlock, onBlockAction, onReplaceDeck, onSetDeck, onSetSlide } = props
  const located = selectedBlockId ? locateBlock(deck, selectedBlockId) : null
  const block = located && slide && located.slide.id === slide.id ? located.block : null
  const deckJson = useMemo(() => (tab === 'json' ? JSON.stringify(deck, null, 2) : ''), [deck, tab])
  const issueCount = diagnostics.filter((item) => item.severity !== 'info').length

  const tabs: Array<{ id: InspectorTab; label: string; icon: UiIconName; count?: number }> = [
    { id: 'design', label: 'Design', icon: 'settings' },
    { id: 'layers', label: 'Layers', icon: 'layers' },
    { id: 'notes', label: 'Notes', icon: 'notes' },
    { id: 'theme', label: 'Theme', icon: 'palette' },
    { id: 'json', label: 'JSON', icon: 'braces' },
    { id: 'issues', label: 'Issues', icon: 'warning', count: issueCount },
  ]

  return (
    <aside className="v2-inspector" aria-label="Inspector">
      <div className="v2-tabs" role="tablist" aria-label="Inspector sections">
        {tabs.map((item) => (
          <button
            key={item.id}
            id={`v2-tab-${item.id}`}
            type="button"
            role="tab"
            aria-selected={tab === item.id}
            aria-controls="v2-inspector-panel"
            tabIndex={tab === item.id ? 0 : -1}
            className="v2-tab"
            title={item.label}
            onClick={() => onTabChange(item.id)}
            onKeyDown={(event) => {
              const index = tabs.findIndex((candidate) => candidate.id === tab)
              if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
                event.preventDefault()
                const next = tabs[(index + (event.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length]
                onTabChange(next.id)
                requestAnimationFrame(() => document.getElementById(`v2-tab-${next.id}`)?.focus())
              }
            }}
          >
            <Icon name={item.icon} size={14} />
            <span className="v2-tab__label">{item.label}</span>
            {item.count ? <span className="v2-tab__count">{item.count}</span> : null}
          </button>
        ))}
      </div>

      <div className="v2-inspector__body" role="tabpanel" id="v2-inspector-panel" aria-labelledby={`v2-tab-${tab}`}>
        {tab === 'design' && slide && (
          <>
            <Breadcrumb slide={slide} slideIndex={slideIndex} trail={located && block ? [...located.ancestors, block] : []} onSelect={onSelectBlock} />
            {block
              ? <BlockDesign key={block.id} {...props} block={block} />
              : <SlideDesign key={slide.id} {...props} slide={slide} slideIndex={slideIndex} />}
          </>
        )}
        {tab === 'layers' && slide && (
          <LayersPanel slide={slide} selectedBlockId={selectedBlockId} disabled={disabled} onSelect={(id) => onSelectBlock(id)} onAction={onBlockAction} />
        )}
        {tab === 'notes' && slide && <NotesPanel slide={slide} disabled={disabled} onSetSlide={onSetSlide} />}
        {tab === 'theme' && <DeckPanel deck={deck} disabled={disabled} onSet={onSetDeck} />}
        {tab === 'json' && (
          <>
            <p className="v2-muted v2-small">The whole presentation as JSON. Applying validates and repairs it like generated output; undo restores the previous version.</p>
            <JsonEditor value={deckJson} onApply={onReplaceDeck} applyLabel="Validate & apply" disabled={disabled} label="Presentation JSON" />
          </>
        )}
        {tab === 'issues' && (
          diagnostics.length ? (
            <ul className="v2-issues">
              {diagnostics.map((item, index) => (
                <li key={index} className={`v2-issue v2-issue--${item.severity}`}>
                  <span className="v2-issue__severity">{item.severity}</span>
                  <span>{item.message}</span>
                  {item.path && <code>{item.path}</code>}
                </li>
              ))}
            </ul>
          ) : <p className="v2-muted">No validation notes for the latest change.</p>
        )}
      </div>
    </aside>
  )
}
