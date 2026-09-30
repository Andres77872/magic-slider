import { z } from 'zod'

import { el, formatNumber, icon, rich, setVars } from '../dom'
import { plainText } from '../richText'
import { alignSchema, colorCss, colorValueSchema, textScale, toneCss, toneSchema } from '../tokens'
import type { PrimitiveDefinition, RenderContext } from '../types'

const SVG_NS = 'http://www.w3.org/2000/svg'

function svg<K extends keyof SVGElementTagNameMap>(context: RenderContext, tag: K, attributes: Record<string, string | number> = {}): SVGElementTagNameMap[K] {
  const node = context.doc.createElementNS(SVG_NS, tag)
  for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, String(value))
  return node
}

/* ---------- stat ---------- */

const statProps = z.strictObject({
  value: z.string().min(1).max(24),
  label: z.string().min(1).max(160),
  description: z.string().min(1).max(300).optional(),
  delta: z.string().min(1).max(24).optional(),
  trend: z.enum(['up', 'down', 'flat']).optional(),
  icon: z.string().min(1).max(40).optional(),
  size: z.enum(['md', 'lg', 'xl', '2xl']).optional(),
  align: alignSchema.optional(),
  tone: toneSchema.optional(),
})

const statSizes = { md: 'xl', lg: '2xl', xl: '3xl', '2xl': 'display' } as const

export const statPrimitive: PrimitiveDefinition<z.infer<typeof statProps>> = {
  type: 'stat',
  category: 'data',
  summary: 'A key figure: big value, label, optional trend delta, icon and description.',
  guidance: 'Put several stats in a grid for a KPI row. Keep values short ("4.2B", "38%", "3×"). Cite the source on the slide.',
  props: statProps,
  example: { type: 'stat', value: '38%', label: 'Lower cost per kWh', delta: '+6 pts', trend: 'up', icon: 'trend-up' },
  render(block, context) {
    const node = el(context, 'div', `ms-stat ms-stat--${block.align ?? 'start'}`)
    setVars(node, { '--ms-font-size': textScale[statSizes[block.size ?? 'lg']], '--ms-color': toneCss(block.tone ?? 'accent') })
    if (block.icon) node.appendChild(icon(context, block.icon, 'ms-icon ms-stat__icon'))
    node.appendChild(el(context, 'span', 'ms-stat__value', block.value))
    node.appendChild(rich(context, 'span', 'ms-stat__label', block.label))
    if (block.delta) {
      const trend = block.trend ?? 'flat'
      const delta = el(context, 'span', `ms-stat__delta ms-stat__delta--${trend}`)
      if (trend !== 'flat') delta.appendChild(icon(context, trend === 'up' ? 'trend-up' : 'trend-down'))
      delta.appendChild(el(context, 'span', undefined, block.delta))
      node.appendChild(delta)
    }
    if (block.description) node.appendChild(rich(context, 'p', 'ms-stat__description', block.description))
    return node
  },
  outline: (block) => `${block.value} — ${plainText(block.label)}`,
}

/* ---------- chart ---------- */

const chartKinds = ['column', 'bar', 'stacked-column', 'stacked-bar', 'line', 'area', 'pie', 'donut'] as const

const chartSeries = z.strictObject({
  name: z.string().min(1).max(60),
  values: z.array(z.number().finite()).min(1).max(24),
  color: colorValueSchema.optional(),
})

const chartProps = z.strictObject({
  kind: z.enum(chartKinds),
  labels: z.array(z.string().min(1).max(40)).min(1).max(24),
  series: z.array(chartSeries).min(1).max(6),
  valuePrefix: z.string().max(6).optional(),
  valueSuffix: z.string().max(8).optional(),
  showValues: z.boolean().optional(),
  showLegend: z.boolean().optional(),
  showGrid: z.boolean().optional(),
  min: z.number().finite().optional(),
  max: z.number().finite().optional(),
  highlight: z.number().int().min(0).optional(),
  centerLabel: z.string().min(1).max(24).optional(),
  title: z.string().min(1).max(120).optional(),
  caption: z.string().min(1).max(200).optional(),
}).superRefine((chart, context) => {
  chart.series.forEach((series, index) => {
    if (series.values.length !== chart.labels.length) {
      context.addIssue({ code: 'custom', path: ['series', index, 'values'], message: `Series "${series.name}" has ${series.values.length} values for ${chart.labels.length} labels.` })
    }
  })
  if ((chart.kind === 'pie' || chart.kind === 'donut') && chart.series[0]?.values.some((value) => value < 0)) {
    context.addIssue({ code: 'custom', path: ['series', 0, 'values'], message: 'Pie and donut values cannot be negative.' })
  }
})

type ChartBlock = z.infer<typeof chartProps>

function seriesColor(chart: ChartBlock, index: number): string {
  const color = chart.series[index]?.color
  return color ? colorCss(color) : `var(--ms-chart-${(index % 6) + 1})`
}

function formatValue(chart: ChartBlock, value: number): string {
  return `${chart.valuePrefix ?? ''}${formatNumber(value)}${chart.valueSuffix ?? ''}`
}

const TICKS = 4

/** Rounds the axis maximum up so each of the four gridline steps is a round number. */
function niceMax(value: number): number {
  if (value <= 0) return 1
  const raw = value / TICKS
  const magnitude = 10 ** Math.floor(Math.log10(raw))
  const step = [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10].find((candidate) => raw / magnitude <= candidate) ?? 10
  return step * magnitude * TICKS
}

function domain(chart: ChartBlock, stacked: boolean): { min: number; max: number } {
  const values = stacked
    ? chart.labels.map((_, index) => chart.series.reduce((sum, series) => sum + Math.max(0, series.values[index] ?? 0), 0))
    : chart.series.flatMap((series) => series.values)
  const dataMin = Math.min(0, ...values)
  const dataMax = Math.max(...values, 0)
  const min = chart.min ?? (dataMin < 0 ? -niceMax(-dataMin) : 0)
  const max = chart.max ?? niceMax(dataMax)
  return { min, max: max > min ? max : min + 1 }
}

function legend(context: RenderContext, chart: ChartBlock, entries: Array<{ label: string; color: string; value?: string }>): HTMLElement {
  const list = el(context, 'ul', 'ms-chart__legend')
  for (const entry of entries) {
    const item = el(context, 'li', 'ms-chart__legend-item')
    const swatch = el(context, 'span', 'ms-chart__swatch')
    swatch.style.setProperty('--ms-swatch', entry.color)
    item.append(swatch, el(context, 'span', 'ms-chart__legend-label', entry.label))
    if (entry.value) item.appendChild(el(context, 'span', 'ms-chart__legend-value', entry.value))
    list.appendChild(item)
  }
  void chart
  return list
}

/** A visually hidden data table keeps every chart readable by screen readers. */
function dataTable(context: RenderContext, chart: ChartBlock): HTMLTableElement {
  const table = el(context, 'table', 'ms-visually-hidden')
  const head = el(context, 'tr')
  head.appendChild(el(context, 'th', undefined, ''))
  for (const series of chart.series) head.appendChild(el(context, 'th', undefined, series.name))
  table.appendChild(head)
  chart.labels.forEach((label, index) => {
    const row = el(context, 'tr')
    row.appendChild(el(context, 'th', undefined, label))
    for (const series of chart.series) row.appendChild(el(context, 'td', undefined, formatValue(chart, series.values[index] ?? 0)))
    table.appendChild(row)
  })
  return table
}

function gridLines(context: RenderContext, range: { min: number; max: number }, chart: ChartBlock, horizontal: boolean): HTMLElement {
  const grid = el(context, 'div', `ms-chart__grid ms-chart__grid--${horizontal ? 'x' : 'y'}`)
  for (let tick = 0; tick <= TICKS; tick += 1) {
    const value = range.min + ((range.max - range.min) * tick) / TICKS
    const line = el(context, 'div', 'ms-chart__gridline')
    line.style.setProperty('--ms-pos', `${(tick / TICKS) * 100}%`)
    line.appendChild(el(context, 'span', 'ms-chart__tick', formatValue(chart, value)))
    grid.appendChild(line)
  }
  return grid
}

function renderBars(context: RenderContext, chart: ChartBlock, horizontal: boolean, stacked: boolean): HTMLElement {
  const range = domain(chart, stacked)
  const span = range.max - range.min
  const plot = el(context, 'div', `ms-chart__plot ms-chart__plot--${horizontal ? 'bar' : 'column'}`)
  if (chart.showGrid !== false) plot.appendChild(gridLines(context, range, chart, horizontal))
  const groups = el(context, 'div', 'ms-chart__groups')
  const showValues = chart.showValues ?? (chart.series.length === 1 || stacked ? chart.labels.length <= 12 : false)

  chart.labels.forEach((label, labelIndex) => {
    const group = el(context, 'div', 'ms-chart__group')
    if (chart.highlight !== undefined) group.classList.add(chart.highlight === labelIndex ? 'ms-chart__group--highlight' : 'ms-chart__group--dim')
    const bars = el(context, 'div', `ms-chart__bars${stacked ? ' ms-chart__bars--stacked' : ''}`)
    // Side-by-side series get one slot each; stacked series share a single slot.
    const stackSlot = stacked ? el(context, 'div', 'ms-chart__slot') : null
    if (stackSlot) bars.appendChild(stackSlot)
    // Geometry is clamped to the axis domain, so an explicit min/max never draws bars outside the plot.
    const position = (value: number) => Math.min(100, Math.max(0, ((value - range.min) / span) * 100))
    let cumulative = 0
    chart.series.forEach((series, seriesIndex) => {
      const raw = series.values[labelIndex] ?? 0
      const value = stacked ? Math.max(0, raw) : raw
      let start: number
      let size: number
      if (stacked) {
        start = position(cumulative)
        size = position(cumulative + value) - start
        cumulative += value
      } else {
        const base = position(0)
        const end = position(value)
        start = Math.min(base, end)
        size = Math.abs(end - base)
      }
      const bar = el(context, 'div', 'ms-chart__bar')
      setVars(bar, { '--ms-start': `${start}%`, '--ms-size': `${size}%`, '--ms-bar-color': seriesColor(chart, seriesIndex) })
      bar.title = `${series.name}: ${formatValue(chart, raw)}`
      if (showValues && (!stacked || size > 7)) bar.appendChild(el(context, 'span', 'ms-chart__value', formatValue(chart, raw)))
      if (stackSlot) {
        stackSlot.appendChild(bar)
      } else {
        const slot = el(context, 'div', 'ms-chart__slot')
        slot.appendChild(bar)
        bars.appendChild(slot)
      }
    })
    group.append(bars, el(context, 'span', 'ms-chart__label', label))
    groups.appendChild(group)
  })
  plot.appendChild(groups)
  return plot
}

function renderLine(context: RenderContext, chart: ChartBlock, area: boolean): HTMLElement {
  const range = domain(chart, false)
  const span = range.max - range.min
  const plot = el(context, 'div', 'ms-chart__plot ms-chart__plot--line')
  if (chart.showGrid !== false) plot.appendChild(gridLines(context, range, chart, false))
  const surface = el(context, 'div', 'ms-chart__surface')
  const svgNode = svg(context, 'svg', { viewBox: '0 0 100 100', preserveAspectRatio: 'none', class: 'ms-chart__svg', 'aria-hidden': 'true' })
  const count = chart.labels.length
  const x = (index: number) => (count === 1 ? 50 : (index / (count - 1)) * 100)
  const y = (value: number) => 100 - ((value - range.min) / span) * 100
  const showValues = chart.showValues ?? (chart.series.length === 1 && count <= 10)

  chart.series.forEach((series, seriesIndex) => {
    const color = seriesColor(chart, seriesIndex)
    const points = series.values.map((value, index) => `${x(index).toFixed(2)},${y(value).toFixed(2)}`)
    if (area) {
      const baseline = y(Math.max(range.min, 0)).toFixed(2)
      const path = svg(context, 'path', {
        d: `M${x(0).toFixed(2)},${baseline} L${points.join(' L')} L${x(count - 1).toFixed(2)},${baseline} Z`,
        class: 'ms-chart__area',
      })
      path.style.setProperty('fill', color)
      svgNode.appendChild(path)
    }
    const line = svg(context, 'polyline', { points: points.join(' '), class: 'ms-chart__line', 'vector-effect': 'non-scaling-stroke' })
    line.style.setProperty('stroke', color)
    svgNode.appendChild(line)
    series.values.forEach((value, index) => {
      const dot = el(context, 'span', 'ms-chart__dot')
      setVars(dot, { '--ms-x': `${x(index)}%`, '--ms-y': `${y(value)}%`, '--ms-bar-color': color })
      if (chart.highlight === index) dot.classList.add('ms-chart__dot--highlight')
      dot.title = `${series.name} · ${chart.labels[index]}: ${formatValue(chart, value)}`
      if (showValues || chart.highlight === index) dot.appendChild(el(context, 'span', 'ms-chart__value', formatValue(chart, value)))
      surface.appendChild(dot)
    })
  })
  surface.prepend(svgNode)
  plot.appendChild(surface)
  const labels = el(context, 'div', 'ms-chart__xlabels')
  chart.labels.forEach((label, index) => {
    const node = el(context, 'span', 'ms-chart__label', label)
    node.style.setProperty('--ms-x', `${x(index)}%`)
    labels.appendChild(node)
  })
  plot.appendChild(labels)
  return plot
}

function renderPie(context: RenderContext, chart: ChartBlock, donut: boolean): HTMLElement {
  const values = chart.series[0].values.map((value) => Math.max(0, value))
  const total = values.reduce((sum, value) => sum + value, 0) || 1
  const wrapper = el(context, 'div', `ms-chart__plot ms-chart__plot--${donut ? 'donut' : 'pie'}`)
  const holder = el(context, 'div', 'ms-chart__pie')
  const svgNode = svg(context, 'svg', { viewBox: '-1 -1 2 2', class: 'ms-chart__svg', 'aria-hidden': 'true' })
  const radius = donut ? 0.78 : 0.5
  const width = donut ? 0.34 : 1
  const sliceColor = (index: number) => (chart.series[0].color && index === 0 ? colorCss(chart.series[0].color) : `var(--ms-chart-${(index % 8) + 1})`)
  let offset = 0
  values.forEach((value, index) => {
    const share = (value / total) * 100
    const slice = svg(context, 'circle', {
      r: radius,
      cx: 0,
      cy: 0,
      pathLength: 100,
      'stroke-width': width,
      'stroke-dasharray': `${share.toFixed(3)} ${(100 - share).toFixed(3)}`,
      'stroke-dashoffset': (-offset).toFixed(3),
      class: 'ms-chart__slice',
    })
    slice.style.setProperty('stroke', sliceColor(index))
    if (chart.highlight !== undefined && chart.highlight !== index) slice.classList.add('ms-chart__slice--dim')
    svgNode.appendChild(slice)
    offset += share
  })
  holder.appendChild(svgNode)
  if (donut) {
    const center = el(context, 'div', 'ms-chart__center')
    const highlighted = chart.highlight !== undefined ? values[chart.highlight] : undefined
    center.appendChild(el(context, 'strong', undefined, chart.centerLabel ?? (highlighted !== undefined ? `${Math.round((highlighted / total) * 100)}%` : formatValue(chart, total))))
    if (!chart.centerLabel && highlighted !== undefined) center.appendChild(el(context, 'span', undefined, chart.labels[chart.highlight!] ?? ''))
    holder.appendChild(center)
  }
  wrapper.appendChild(holder)
  if (chart.showLegend !== false) {
    wrapper.appendChild(legend(context, chart, chart.labels.map((label, index) => ({
      label,
      color: sliceColor(index),
      value: chart.showValues === false ? undefined : `${formatValue(chart, values[index])} · ${Math.round((values[index] / total) * 100)}%`,
    }))))
  }
  return wrapper
}

/** Aligns series with labels without inventing data: long series are cut, short ones dropped. */
function repairChart(props: Record<string, unknown>, note: (message: string) => void): Record<string, unknown> {
  const next = { ...props }
  if (!Array.isArray(next.labels) || !Array.isArray(next.series)) return next
  // A bare number list is read as one unnamed series.
  const seriesList: unknown[] = next.series.every((value) => typeof value === 'number') ? [{ name: 'Value', values: next.series }] : next.series
  const labelCount = next.labels.length
  const kept: unknown[] = []
  for (const series of seriesList) {
    if (!series || typeof series !== 'object' || !Array.isArray((series as { values?: unknown }).values)) {
      kept.push(series)
      continue
    }
    const values = (series as { values: unknown[] }).values
    if (values.length > labelCount) {
      note('Trimmed chart values to match the labels.')
      kept.push({ ...series, values: values.slice(0, labelCount) })
    } else if (values.length < labelCount) {
      note('Dropped a chart series with fewer values than labels.')
    } else {
      kept.push(series)
    }
  }
  next.series = kept
  if (typeof next.highlight === 'number' && next.highlight >= labelCount) delete next.highlight
  return next
}

export const chartPrimitive: PrimitiveDefinition<ChartBlock> = {
  type: 'chart',
  category: 'data',
  repair: repairChart,
  summary: 'A data chart: column, bar, stacked-column, stacked-bar, line, area, pie or donut.',
  guidance: 'Every series needs one number per label. Use real, sourced numbers and cite them in the slide sources. highlight emphasizes one label (dims the rest); prefer it over many colors. valueSuffix "%" or "B" formats values.',
  props: chartProps,
  example: {
    type: 'chart',
    kind: 'column',
    labels: ['2020', '2022', '2024', '2026'],
    series: [{ name: 'Solar capacity (GW)', values: [714, 1053, 1600, 2400] }],
    valueSuffix: ' GW',
    highlight: 3,
    caption: 'Source: IEA',
  },
  render(block, context) {
    const node = el(context, 'figure', `ms-chart ms-chart--${block.kind}`)
    node.setAttribute('role', 'img')
    node.setAttribute('aria-label', [block.title, `${block.kind} chart`, block.series.map((series) => series.name).join(', ')].filter(Boolean).join(' — '))
    if (block.title) node.appendChild(el(context, 'figcaption', 'ms-chart__title', block.title))
    const body = block.kind === 'pie' || block.kind === 'donut'
      ? renderPie(context, block, block.kind === 'donut')
      : block.kind === 'line' || block.kind === 'area'
        ? renderLine(context, block, block.kind === 'area')
        : renderBars(context, block, block.kind === 'bar' || block.kind === 'stacked-bar', block.kind.startsWith('stacked'))
    node.appendChild(body)
    const multiSeries = block.series.length > 1 && block.kind !== 'pie' && block.kind !== 'donut'
    if (multiSeries && block.showLegend !== false) {
      node.appendChild(legend(context, block, block.series.map((series, index) => ({ label: series.name, color: seriesColor(block, index) }))))
    }
    if (block.caption) node.appendChild(el(context, 'p', 'ms-chart__caption', block.caption))
    node.appendChild(dataTable(context, block))
    return node
  },
  outline: (block) => `${block.kind} chart: ${block.series.map((series) => series.name).join(', ')} over ${block.labels.join(', ')}`.slice(0, 200),
}

/* ---------- table ---------- */

const tableCell = z.union([z.string().max(200), z.number().finite(), z.null()])
const tableColumn = z.union([
  z.string().max(80),
  z.strictObject({ header: z.string().max(80), align: alignSchema.optional() }),
])

const tableProps = z.strictObject({
  columns: z.array(tableColumn).min(1).max(8),
  rows: z.array(z.array(tableCell).min(1).max(8)).min(1).max(14),
  highlightRow: z.number().int().min(0).optional(),
  highlightColumn: z.number().int().min(0).optional(),
  striped: z.boolean().optional(),
  compact: z.boolean().optional(),
  caption: z.string().min(1).max(200).optional(),
})

const CHECK_CELLS = new Set(['✓', '✔', '✅'])
const CROSS_CELLS = new Set(['✗', '✘', '✕', '❌'])

const TABLE_TEXT_MAX = 200

/** Coerces one generated cell to string | number | null without shifting its column. */
function coerceTableCell(value: unknown): string | number | null {
  if (value === null || value === undefined) return null
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value === 'boolean') return value ? '✓' : '✗'
  if (typeof value === 'string') return value.length > TABLE_TEXT_MAX ? `${value.slice(0, TABLE_TEXT_MAX - 1)}…` : value
  if (typeof value === 'object' && value && 'text' in value && typeof (value as { text: unknown }).text === 'string') return coerceTableCell((value as { text: string }).text)
  return null
}

/**
 * Tables are positional: repairing by deleting a header or cell would shift
 * every later column. Headers and cells are therefore coerced in place, rows
 * written as objects are read by header, and every row is padded or cut to the
 * column count before validation.
 */
function repairTable(props: Record<string, unknown>, note: (message: string) => void): Record<string, unknown> {
  const next = { ...props }
  if (Array.isArray(next.columns)) {
    next.columns = next.columns.slice(0, 8).map((column) => {
      if (typeof column === 'string') return column.slice(0, 80)
      if (column && typeof column === 'object') {
        const record = column as Record<string, unknown>
        const header = typeof record.header === 'string' ? record.header.slice(0, 80) : typeof record.label === 'string' ? record.label.slice(0, 80) : String(record.header ?? '')
        return ['start', 'center', 'end'].includes(String(record.align)) ? { header, align: record.align } : { header }
      }
      return column === null || column === undefined ? '' : String(column).slice(0, 80)
    })
  }
  if (!Array.isArray(next.rows)) return next
  const headers = Array.isArray(next.columns)
    ? next.columns.map((column) => (typeof column === 'string' ? column : column && typeof column === 'object' ? String((column as { header?: unknown }).header ?? '') : ''))
    : []
  if (!headers.length && next.rows.length && next.rows.every((row) => row && typeof row === 'object' && !Array.isArray(row))) {
    next.columns = Object.keys(next.rows[0] as object)
    headers.push(...(next.columns as string[]))
  }
  next.rows = next.rows.map((row) => {
    if (row && typeof row === 'object' && !Array.isArray(row)) {
      note('Read table rows written as objects.')
      return headers.map((header) => (row as Record<string, unknown>)[header] ?? null)
    }
    return row
  })
  const width = Array.isArray(next.columns) ? next.columns.length : headers.length
  let changedCells = false
  next.rows = (next.rows as unknown[]).slice(0, 14).map((row) => {
    if (!Array.isArray(row)) return row
    const cells = row.map((cell) => {
      const coerced = coerceTableCell(cell)
      if (coerced !== cell) changedCells = true
      return coerced
    })
    if (width && cells.length > width) return cells.slice(0, width)
    while (width && cells.length < width) cells.push(null)
    return cells
  })
  if (changedCells) note('Converted table cells that were not text or numbers.')
  return next
}

export const tablePrimitive: PrimitiveDefinition<z.infer<typeof tableProps>> = {
  type: 'table',
  category: 'data',
  repair: repairTable,
  summary: 'A data or comparison table with optional highlighted row/column.',
  guidance: 'Cells accept rich text or numbers; "✓" and "✗" render as check and cross icons (feature comparisons). Up to 8 columns × 14 rows; fewer reads better.',
  props: tableProps,
  example: {
    type: 'table',
    columns: ['Plan', { header: 'Price', align: 'end' }, { header: 'Support', align: 'center' }],
    rows: [['Starter', '$9', '✗'], ['Pro', '$29', '✓']],
    highlightRow: 1,
  },
  render(block, context) {
    const wrapper = el(context, 'div', `ms-table${block.compact ? ' ms-table--compact' : ''}${block.striped === false ? '' : ' ms-table--striped'}`)
    const table = el(context, 'table', 'ms-table__table')
    const aligns = block.columns.map((column) => (typeof column === 'string' ? undefined : column.align))
    const head = el(context, 'thead')
    const headRow = el(context, 'tr')
    block.columns.forEach((column, index) => {
      const th = el(context, 'th', undefined)
      th.scope = 'col'
      th.appendChild(rich(context, 'span', '', typeof column === 'string' ? column : column.header))
      if (aligns[index]) th.dataset.align = aligns[index]
      if (block.highlightColumn === index) th.classList.add('ms-table__highlight')
      headRow.appendChild(th)
    })
    head.appendChild(headRow)
    table.appendChild(head)
    const body = el(context, 'tbody')
    block.rows.forEach((row, rowIndex) => {
      const tr = el(context, 'tr')
      if (block.highlightRow === rowIndex) tr.classList.add('ms-table__highlight-row')
      block.columns.forEach((_, columnIndex) => {
        const value = row[columnIndex]
        const cell = el(context, columnIndex === 0 ? 'th' : 'td')
        if (columnIndex === 0) (cell as HTMLTableCellElement).scope = 'row'
        if (aligns[columnIndex]) cell.dataset.align = aligns[columnIndex]
        else if (typeof value === 'number') cell.dataset.align = 'end'
        if (block.highlightColumn === columnIndex) cell.classList.add('ms-table__highlight')
        if (typeof value === 'number') cell.textContent = formatNumber(value)
        else if (typeof value === 'string' && CHECK_CELLS.has(value.trim())) cell.appendChild(icon(context, 'check', 'ms-icon ms-table__yes'))
        else if (typeof value === 'string' && CROSS_CELLS.has(value.trim())) cell.appendChild(icon(context, 'x', 'ms-icon ms-table__no'))
        else if (typeof value === 'string' && value) cell.appendChild(rich(context, 'span', '', value))
        tr.appendChild(cell)
      })
      body.appendChild(tr)
    })
    table.appendChild(body)
    wrapper.appendChild(table)
    if (block.caption) wrapper.appendChild(el(context, 'p', 'ms-chart__caption', block.caption))
    return wrapper
  },
  outline: (block) => `table: ${block.columns.map((column) => (typeof column === 'string' ? column : column.header)).join(' | ')} (${block.rows.length} rows)`,
}

/* ---------- progress ---------- */

const progressProps = z.strictObject({
  value: z.number().finite(),
  max: z.number().finite().positive().optional(),
  label: z.string().min(1).max(120).optional(),
  variant: z.enum(['bar', 'ring']).optional(),
  tone: toneSchema.optional(),
  showValue: z.boolean().optional(),
  valueSuffix: z.string().max(8).optional(),
})

export const progressPrimitive: PrimitiveDefinition<z.infer<typeof progressProps>> = {
  type: 'progress',
  category: 'data',
  summary: 'A progress bar or ring showing a value against a maximum (default 100).',
  props: progressProps,
  example: { type: 'progress', value: 72, label: 'Renewables share of new capacity', variant: 'ring', valueSuffix: '%' },
  render(block, context) {
    const max = block.max ?? 100
    const ratio = Math.min(1, Math.max(0, block.value / max))
    const variant = block.variant ?? 'bar'
    const node = el(context, 'div', `ms-progress ms-progress--${variant}`)
    node.setAttribute('role', 'meter')
    node.setAttribute('aria-valuemin', '0')
    node.setAttribute('aria-valuemax', String(max))
    node.setAttribute('aria-valuenow', String(block.value))
    if (block.label) node.setAttribute('aria-label', block.label)
    setVars(node, { '--ms-progress': `${(ratio * 100).toFixed(2)}%`, '--ms-progress-ratio': ratio.toFixed(4), '--ms-color': toneCss(block.tone ?? 'accent') })
    const valueText = `${formatNumber(block.value)}${block.valueSuffix ?? (block.max === undefined ? '%' : '')}`
    if (variant === 'ring') {
      const ring = el(context, 'div', 'ms-progress__ring')
      const svgNode = svg(context, 'svg', { viewBox: '-1 -1 2 2', 'aria-hidden': 'true' })
      svgNode.appendChild(svg(context, 'circle', { r: 0.84, cx: 0, cy: 0, class: 'ms-progress__track', 'stroke-width': 0.16 }))
      svgNode.appendChild(svg(context, 'circle', {
        r: 0.84, cx: 0, cy: 0, pathLength: 100, class: 'ms-progress__fill', 'stroke-width': 0.16,
        'stroke-dasharray': `${(ratio * 100).toFixed(3)} 100`,
      }))
      ring.appendChild(svgNode)
      if (block.showValue !== false) ring.appendChild(el(context, 'strong', 'ms-progress__value', valueText))
      node.appendChild(ring)
      if (block.label) node.appendChild(el(context, 'span', 'ms-progress__label', block.label))
    } else {
      const header = el(context, 'div', 'ms-progress__header')
      if (block.label) header.appendChild(el(context, 'span', 'ms-progress__label', block.label))
      if (block.showValue !== false) header.appendChild(el(context, 'strong', 'ms-progress__value', valueText))
      node.appendChild(header)
      const track = el(context, 'div', 'ms-progress__track')
      track.appendChild(el(context, 'div', 'ms-progress__fill'))
      node.appendChild(track)
    }
    return node
  },
  outline: (block) => `${block.label ?? 'progress'}: ${block.value}/${block.max ?? 100}`,
}

/* ---------- code ---------- */

const LINE_TOKEN = /^\d{1,4}(?:-\d{1,4})?$/

/** Parses Reveal-style line steps ("1,3-5|8") into 1-based line sets; null when malformed. */
export function parseLineSteps(value: string, lineCount: number): Array<Array<[number, number]>> | null {
  const steps: Array<Array<[number, number]>> = []
  for (const step of value.replace(/\s+/g, '').split('|')) {
    const ranges: Array<[number, number]> = []
    for (const token of step.split(',')) {
      if (token === '') continue
      if (!LINE_TOKEN.test(token)) return null
      const [from, to = from] = token.split('-').map(Number)
      const start = Math.max(1, Math.min(from, to))
      const end = Math.min(lineCount, Math.max(from, to))
      if (start <= end) ranges.push([start, end])
    }
    steps.push(ranges)
  }
  return steps.length > 12 ? null : steps
}

const codeProps = z.strictObject({
  source: z.string().min(1).max(4_000),
  language: z.string().max(30).regex(/^[a-z0-9][a-z0-9+#.-]{0,29}$/, 'Unsupported code language name.').optional(),
  title: z.string().min(1).max(80).optional(),
  lineNumbers: z.boolean().optional(),
  highlight: z.string().max(80).refine((value) => parseLineSteps(value, 9_999) !== null, 'Use line steps such as "1,3-5|8" (at most 12 steps).').optional(),
  size: z.enum(['sm', 'md', 'lg']).optional(),
})

/** Drops leading and trailing blank lines but keeps indentation. */
function codeLines(source: string): string[] {
  const lines = source.replace(/\r\n?/g, '\n').split('\n')
  while (lines.length > 1 && !lines[0].trim()) lines.shift()
  while (lines.length > 1 && !lines[lines.length - 1].trim()) lines.pop()
  return lines
}

export const codePrimitive: PrimitiveDefinition<z.infer<typeof codeProps>> = {
  type: 'code',
  category: 'data',
  summary: 'A syntax-highlighted code block with optional file title, line numbers and step-by-step line highlights.',
  guidance: 'highlight "1-2|4|6-8" walks through line ranges one step at a time (each | is one click). Keep snippets under ~18 lines.',
  props: codeProps,
  example: { type: 'code', language: 'ts', title: 'deck.ts', source: "const deck = await agent.generate('Pitch our product')\nrender(deck)", lineNumbers: true, highlight: '1|2' },
  render(block, context) {
    const lines = codeLines(block.source)
    const node = el(context, 'div', `ms-code ms-code--${block.size ?? 'md'}`)
    if (block.title) {
      const bar = el(context, 'div', 'ms-code__bar')
      bar.append(el(context, 'span', 'ms-code__dots'), el(context, 'span', 'ms-code__title', block.title))
      node.appendChild(bar)
    }
    const body = el(context, 'div', `ms-code__body${block.lineNumbers ? ' ms-code__body--numbered' : ''}`)
    // Line numbers and step highlights are plain DOM (no Reveal plugin), so the
    // preview, thumbnails and the HTML export all show them identically.
    if (block.lineNumbers) {
      const gutter = el(context, 'div', 'ms-code__gutter')
      gutter.setAttribute('aria-hidden', 'true')
      lines.forEach((_, index) => gutter.appendChild(el(context, 'span', undefined, String(index + 1))))
      body.appendChild(gutter)
    }
    const steps = block.highlight ? parseLineSteps(block.highlight, lines.length) ?? [] : []
    if (steps.length) {
      const marks = el(context, 'div', 'ms-code__marks')
      marks.setAttribute('aria-hidden', 'true')
      steps.forEach((ranges, stepIndex) => {
        for (const [from, to] of ranges) {
          const mark = el(context, 'span', 'ms-code__mark')
          setVars(mark, { '--ms-from': from, '--ms-count': to - from + 1 })
          if (steps.length > 1) {
            // Step 0 shows first; each click fades the current step out and the next one in.
            const last = stepIndex === steps.length - 1
            mark.classList.add('fragment', stepIndex === 0 ? 'fade-out' : last ? 'fade-in' : 'fade-in-then-out')
            mark.setAttribute('data-fragment-index', String(stepIndex === 0 ? 0 : stepIndex - 1))
          }
          marks.appendChild(mark)
        }
      })
      body.appendChild(marks)
    }
    const pre = el(context, 'pre', 'ms-code__pre')
    const code = el(context, 'code', block.language ? `language-${block.language}` : 'nohighlight', lines.join('\n'))
    code.setAttribute('data-noescape', '')
    pre.appendChild(code)
    body.appendChild(pre)
    node.appendChild(body)
    return node
  },
  outline: (block) => `code${block.title ? ` ${block.title}` : ''} (${block.language ?? 'text'}, ${block.source.split('\n').length} lines)`,
}

export const dataPrimitives = [statPrimitive, chartPrimitive, tablePrimitive, progressPrimitive, codePrimitive]
