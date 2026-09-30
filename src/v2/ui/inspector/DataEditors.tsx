import { useEffect, useState } from 'react'

import type { Block } from '../../catalog/types'
import Icon from '../common/Icon'

/**
 * Spreadsheet-style editors for the two data primitives. The grid is edited
 * as a draft and committed as one update_block when a cell loses focus, so a
 * whole data edit is one undo step and is validated by the chart or table
 * schema like any other change.
 */

type Set = (set: Record<string, unknown>) => string | null

interface Series {
  name: string
  values: number[]
  color?: string
}

interface ChartDraft {
  labels: string[]
  series: Array<{ name: string; values: string[]; color?: string }>
}

function chartDraft(block: Block): ChartDraft {
  const labels = Array.isArray(block.labels) ? block.labels.map(String) : []
  const series = Array.isArray(block.series) ? block.series as Series[] : []
  return { labels, series: series.map((entry) => ({ name: entry.name, color: entry.color, values: labels.map((_, index) => (entry.values[index] === undefined ? '' : String(entry.values[index]))) })) }
}

export function ChartDataEditor({ block, disabled, onSet }: { block: Block; disabled?: boolean; onSet: Set }) {
  const source = JSON.stringify({ labels: block.labels, series: block.series })
  const [draft, setDraft] = useState<ChartDraft>(() => chartDraft(block))
  const [error, setError] = useState<string | null>(null)
  useEffect(() => { setDraft(chartDraft(block)); setError(null) }, [source])

  const commit = (next: ChartDraft = draft) => {
    const labels = next.labels.map((label) => label.trim())
    if (labels.some((label) => !label)) return setError('Every row needs a label.')
    const series: Series[] = []
    for (const entry of next.series) {
      const values = entry.values.map((value) => (value.trim() === '' ? Number.NaN : Number(value.replace(/,/g, ''))))
      if (values.some((value) => !Number.isFinite(value))) return setError(`Every value in “${entry.name}” must be a number.`)
      series.push({ name: entry.name.trim() || 'Series', values, ...(entry.color ? { color: entry.color } : {}) })
    }
    if (JSON.stringify({ labels, series: series.map(({ name, values, color }) => ({ name, values, ...(color ? { color } : {}) })) }) === JSON.stringify({ labels: block.labels, series: block.series })) return setError(null)
    setError(onSet({ labels, series }))
  }

  const update = (mutate: (copy: ChartDraft) => void, immediate = false) => {
    const copy: ChartDraft = { labels: [...draft.labels], series: draft.series.map((entry) => ({ ...entry, values: [...entry.values] })) }
    mutate(copy)
    setDraft(copy)
    if (immediate) commit(copy)
  }

  return (
    <div className="v2-datagrid">
      <div className="v2-datagrid__scroll">
        <table>
          <thead>
            <tr>
              <th scope="col">Label</th>
              {draft.series.map((entry, seriesIndex) => (
                <th key={seriesIndex} scope="col">
                  <span className="v2-datagrid__series">
                    <input className="v2-cell v2-cell--head" aria-label={`Series ${seriesIndex + 1} name`} value={entry.name} disabled={disabled} onChange={(event) => update((copy) => { copy.series[seriesIndex].name = event.target.value })} onBlur={() => commit()} />
                    <button type="button" className="v2-mini v2-mini--danger" aria-label={`Remove series ${entry.name}`} disabled={disabled || draft.series.length <= 1} onClick={() => update((copy) => { copy.series.splice(seriesIndex, 1) }, true)}><Icon name="x" size={12} /></button>
                  </span>
                </th>
              ))}
              <th className="v2-datagrid__add">
                <button type="button" className="v2-mini" aria-label="Add series" disabled={disabled || draft.series.length >= 6} onClick={() => update((copy) => { copy.series.push({ name: `Series ${copy.series.length + 1}`, values: copy.labels.map(() => '0') }) }, true)}><Icon name="plus" size={13} /></button>
              </th>
            </tr>
          </thead>
          <tbody>
            {draft.labels.map((label, rowIndex) => (
              <tr key={rowIndex}>
                <th scope="row"><input className="v2-cell" aria-label={`Row ${rowIndex + 1} label`} value={label} disabled={disabled} onChange={(event) => update((copy) => { copy.labels[rowIndex] = event.target.value })} onBlur={() => commit()} /></th>
                {draft.series.map((entry, seriesIndex) => (
                  <td key={seriesIndex}>
                    <input className="v2-cell v2-cell--number" inputMode="decimal" aria-label={`${entry.name}, ${label}`} value={entry.values[rowIndex] ?? ''} disabled={disabled} onChange={(event) => update((copy) => { copy.series[seriesIndex].values[rowIndex] = event.target.value })} onBlur={() => commit()} />
                  </td>
                ))}
                <td className="v2-datagrid__add">
                  <button type="button" className="v2-mini v2-mini--danger" aria-label={`Remove row ${label}`} disabled={disabled || draft.labels.length <= 1} onClick={() => update((copy) => { copy.labels.splice(rowIndex, 1); copy.series.forEach((entry) => entry.values.splice(rowIndex, 1)) }, true)}><Icon name="x" size={12} /></button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <button type="button" className="v2-button v2-button--ghost v2-button--sm" disabled={disabled || draft.labels.length >= 24} onClick={() => update((copy) => { copy.labels.push(`Item ${copy.labels.length + 1}`); copy.series.forEach((entry) => entry.values.push('0')) }, true)}><Icon name="plus" size={14} />Add row</button>
      {error && <p className="v2-field-row__error" role="alert">{error}</p>}
    </div>
  )
}

type Cell = string | number | null
type Column = string | { header: string; align?: 'start' | 'center' | 'end' }

interface TableDraft {
  columns: string[]
  rows: string[][]
}

function tableDraft(block: Block): TableDraft {
  const columns = (Array.isArray(block.columns) ? block.columns as Column[] : []).map((column) => (typeof column === 'string' ? column : column.header))
  const rows = (Array.isArray(block.rows) ? block.rows as Cell[][] : []).map((row) => columns.map((_, index) => (row[index] === null || row[index] === undefined ? '' : String(row[index]))))
  return { columns, rows }
}

export function TableEditor({ block, disabled, onSet }: { block: Block; disabled?: boolean; onSet: Set }) {
  const source = JSON.stringify({ columns: block.columns, rows: block.rows })
  const [draft, setDraft] = useState<TableDraft>(() => tableDraft(block))
  const [error, setError] = useState<string | null>(null)
  useEffect(() => { setDraft(tableDraft(block)); setError(null) }, [source])
  const original = (Array.isArray(block.columns) ? block.columns : []) as Column[]
  const originalRows = (Array.isArray(block.rows) ? block.rows : []) as Cell[][]

  const commit = (next: TableDraft = draft) => {
    const columns: Column[] = next.columns.map((header, index) => {
      const before = original[index]
      return before && typeof before === 'object' ? { ...before, header } : header
    })
    const rows: Cell[][] = next.rows.map((row, rowIndex) => row.map((cell, columnIndex) => {
      const before = originalRows[rowIndex]?.[columnIndex]
      if (!cell.trim()) return null
      return typeof before === 'number' && Number.isFinite(Number(cell)) ? Number(cell) : cell
    }))
    if (JSON.stringify({ columns, rows }) === JSON.stringify({ columns: block.columns, rows: block.rows })) return setError(null)
    setError(onSet({ columns, rows }))
  }
  const update = (mutate: (copy: TableDraft) => void, immediate = false) => {
    const copy: TableDraft = { columns: [...draft.columns], rows: draft.rows.map((row) => [...row]) }
    mutate(copy)
    setDraft(copy)
    if (immediate) commit(copy)
  }

  return (
    <div className="v2-datagrid">
      <div className="v2-datagrid__scroll">
        <table>
          <thead>
            <tr>
              {draft.columns.map((column, columnIndex) => (
                <th key={columnIndex} scope="col">
                  <span className="v2-datagrid__series">
                    <input className="v2-cell v2-cell--head" aria-label={`Column ${columnIndex + 1} header`} value={column} disabled={disabled} onChange={(event) => update((copy) => { copy.columns[columnIndex] = event.target.value })} onBlur={() => commit()} />
                    <button type="button" className="v2-mini v2-mini--danger" aria-label={`Remove column ${columnIndex + 1}`} disabled={disabled || draft.columns.length <= 1} onClick={() => update((copy) => { copy.columns.splice(columnIndex, 1); copy.rows.forEach((row) => row.splice(columnIndex, 1)) }, true)}><Icon name="x" size={12} /></button>
                  </span>
                </th>
              ))}
              <th className="v2-datagrid__add">
                <button type="button" className="v2-mini" aria-label="Add column" disabled={disabled || draft.columns.length >= 8} onClick={() => update((copy) => { copy.columns.push(`Column ${copy.columns.length + 1}`); copy.rows.forEach((row) => row.push('')) }, true)}><Icon name="plus" size={13} /></button>
              </th>
            </tr>
          </thead>
          <tbody>
            {draft.rows.map((row, rowIndex) => (
              <tr key={rowIndex}>
                {row.map((cell, columnIndex) => (
                  <td key={columnIndex}>
                    <input className="v2-cell" aria-label={`Row ${rowIndex + 1}, ${draft.columns[columnIndex] || `column ${columnIndex + 1}`}`} value={cell} disabled={disabled} onChange={(event) => update((copy) => { copy.rows[rowIndex][columnIndex] = event.target.value })} onBlur={() => commit()} />
                  </td>
                ))}
                <td className="v2-datagrid__add">
                  <button type="button" className="v2-mini v2-mini--danger" aria-label={`Remove row ${rowIndex + 1}`} disabled={disabled || draft.rows.length <= 1} onClick={() => update((copy) => { copy.rows.splice(rowIndex, 1) }, true)}><Icon name="x" size={12} /></button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <button type="button" className="v2-button v2-button--ghost v2-button--sm" disabled={disabled || draft.rows.length >= 14} onClick={() => update((copy) => { copy.rows.push(copy.columns.map(() => '')) }, true)}><Icon name="plus" size={14} />Add row</button>
      {error && <p className="v2-field-row__error" role="alert">{error}</p>}
    </div>
  )
}
