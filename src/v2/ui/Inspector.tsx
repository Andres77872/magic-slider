import { useEffect, useMemo, useState, type ReactNode } from 'react'

import { getPrimitive } from '../catalog/registry'
import type { Block } from '../catalog/types'
import type { Deck, Slide } from '../domain/deckSchema'
import type { DeckDiagnostic } from '../domain/normalize'
import type { DeckOperation } from '../domain/operations'

type Tab = 'outline' | 'block' | 'notes' | 'json' | 'issues'

interface InspectorProps {
  deck: Deck
  slide: Slide | null
  selectedBlockId: string | null
  diagnostics: DeckDiagnostic[]
  fitScale?: number
  disabled?: boolean
  onSelectBlock: (blockId: string | null) => void
  onApplyOperations: (operations: DeckOperation[], summary: string) => string | null
  onReplaceDeck: (json: string) => string | null
}

function findBlock(blocks: readonly Block[], id: string): Block | null {
  for (const block of blocks) {
    if (block.id === id) return block
    const nested = block.children ? findBlock(block.children, id) : null
    if (nested) return nested
  }
  return null
}

function OutlineTree({ blocks, selectedBlockId, onSelect, depth = 0 }: { blocks: readonly Block[]; selectedBlockId: string | null; onSelect: (id: string) => void; depth?: number }) {
  return (
    <ul className="v2-tree" role={depth === 0 ? 'tree' : 'group'}>
      {blocks.map((block) => {
        const primitive = getPrimitive(block.type)
        const outline = primitive?.outline ? primitive.outline(block as never) : ''
        return (
          <li key={block.id} role="treeitem" aria-selected={block.id === selectedBlockId}>
            <button type="button" className={`v2-tree__item${block.id === selectedBlockId ? ' v2-tree__item--selected' : ''}`} onClick={() => block.id && onSelect(block.id)}>
              <span className="v2-tree__type">{block.type}</span>
              <span className="v2-tree__text">{outline || block.id}</span>
            </button>
            {block.children && block.children.length > 0 && <OutlineTree blocks={block.children} selectedBlockId={selectedBlockId} onSelect={onSelect} depth={depth + 1} />}
          </li>
        )
      })}
    </ul>
  )
}

function JsonEditor({ value, onApply, applyLabel, disabled, extra }: { value: string; onApply: (text: string) => string | null; applyLabel: string; disabled?: boolean; extra?: ReactNode }) {
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
      <textarea className="v2-json__input" spellCheck={false} value={draft} onChange={(event) => setDraft(event.target.value)} disabled={disabled} aria-label="JSON" />
      {error && <p className="v2-json__error" role="alert">{error}</p>}
      {stale && !error && <p className="v2-json__error" role="status">The presentation changed since you started editing. Apply to overwrite it, or Reset to load the latest version.</p>}
      <div className="v2-json__actions">
        {extra}
        <button type="button" className="v2-button v2-button--ghost" disabled={!dirty && !stale} onClick={() => { setDraft(value); setBase(value); setError(null) }}>Reset</button>
        <button
          type="button"
          className="v2-button v2-button--primary"
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

export default function Inspector({ deck, slide, selectedBlockId, diagnostics, fitScale, disabled, onSelectBlock, onApplyOperations, onReplaceDeck }: InspectorProps) {
  const [tab, setTab] = useState<Tab>('outline')
  const block = useMemo(() => (slide && selectedBlockId ? findBlock(slide.blocks, selectedBlockId) : null), [slide, selectedBlockId])
  const deckJson = useMemo(() => JSON.stringify(deck, null, 2), [deck])
  const blockJson = useMemo(() => (block ? JSON.stringify(block, null, 2) : ''), [block])

  useEffect(() => {
    if (selectedBlockId) setTab((current) => (current === 'outline' ? 'block' : current))
  }, [selectedBlockId])

  const tabs: Array<{ id: Tab; label: string; count?: number }> = [
    { id: 'outline', label: 'Outline' },
    { id: 'block', label: 'Block' },
    { id: 'notes', label: 'Notes' },
    { id: 'json', label: 'JSON' },
    { id: 'issues', label: 'Issues', count: diagnostics.filter((item) => item.severity !== 'info').length },
  ]

  const applyBlock = (text: string): string | null => {
    if (!block?.id) return 'Select a block first.'
    let parsed: unknown
    try {
      parsed = JSON.parse(text)
    } catch (cause) {
      return `Invalid JSON: ${String(cause)}`
    }
    return onApplyOperations([{ op: 'replace_block', blockId: block.id, block: parsed }], `Edited block ${block.id}.`)
  }

  return (
    <aside className="v2-inspector" aria-label="Inspector">
      <div className="v2-tabs" role="tablist">
        {tabs.map((item) => (
          <button key={item.id} type="button" role="tab" aria-selected={tab === item.id} className="v2-tab" onClick={() => setTab(item.id)}>
            {item.label}{item.count ? <span className="v2-tab__count">{item.count}</span> : null}
          </button>
        ))}
      </div>

      <div className="v2-inspector__body" role="tabpanel">
        {tab === 'outline' && (
          slide ? (
            <>
              <header className="v2-inspector__header">
                <strong>{slide.name ?? slide.id}</strong>
                <code>{slide.id}</code>
              </header>
              <dl className="v2-props">
                {slide.align && <><dt>align</dt><dd>{slide.align}</dd></>}
                {slide.tone && slide.tone !== 'default' && <><dt>tone</dt><dd>{slide.tone}</dd></>}
                {slide.background && <><dt>background</dt><dd>{[slide.background.image && 'image', typeof slide.background.gradient === 'string' ? slide.background.gradient : slide.background.gradient && 'gradient', slide.background.color, slide.background.pattern].filter(Boolean).join(' · ')}</dd></>}
                {fitScale !== undefined && fitScale < 0.97 && <><dt>fit</dt><dd className="v2-warn">scaled to {Math.round(fitScale * 100)}%</dd></>}
              </dl>
              {slide.blocks.length ? <OutlineTree blocks={slide.blocks} selectedBlockId={selectedBlockId} onSelect={(id) => onSelectBlock(id)} /> : <p className="v2-muted">This slide has no blocks.</p>}
              <div className="v2-inspector__actions">
                <button type="button" className="v2-button v2-button--ghost" disabled={disabled} onClick={() => onApplyOperations([{ op: 'duplicate_slide', slideId: slide.id }], `Duplicated slide ${slide.id}.`)}>Duplicate slide</button>
                <button type="button" className="v2-button v2-button--danger" disabled={disabled || deck.slides.length <= 1} onClick={() => onApplyOperations([{ op: 'remove_slides', slideIds: [slide.id] }], `Deleted slide ${slide.id}.`)}>Delete slide</button>
              </div>
            </>
          ) : <p className="v2-muted">No slide selected.</p>
        )}

        {tab === 'block' && (
          block ? (
            <>
              <header className="v2-inspector__header">
                <strong>{block.type}</strong>
                <code>{block.id}</code>
                <button type="button" className="v2-link" onClick={() => onSelectBlock(null)}>Clear</button>
              </header>
              <p className="v2-muted v2-small">{getPrimitive(block.type)?.summary}</p>
              <JsonEditor
                value={blockJson}
                onApply={applyBlock}
                applyLabel="Apply"
                disabled={disabled}
                extra={<button type="button" className="v2-button v2-button--danger" disabled={disabled} onClick={() => { onApplyOperations([{ op: 'remove_blocks', blockIds: [block.id!] }], `Deleted block ${block.id}.`); onSelectBlock(null) }}>Delete</button>}
              />
            </>
          ) : <p className="v2-muted">Click any element in the preview, or pick one in the outline, to inspect and edit its JSON.</p>
        )}

        {tab === 'notes' && slide && (
          <div className="v2-notes">
            <h3>Speaker notes</h3>
            <p className="v2-notes__text">{slide.notes || 'No notes for this slide.'}</p>
            {slide.sources && slide.sources.length > 0 && (
              <>
                <h3>Sources</h3>
                <ol className="v2-sources">
                  {slide.sources.map((source) => <li key={source.url}><a href={source.url} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer">{source.title}</a></li>)}
                </ol>
              </>
            )}
          </div>
        )}

        {tab === 'json' && <JsonEditor value={deckJson} onApply={onReplaceDeck} applyLabel="Validate & apply" disabled={disabled} />}

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
