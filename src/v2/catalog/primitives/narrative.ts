import { z } from 'zod'

import { el, icon, rich, setVars, stagger } from '../dom'
import { plainText } from '../richText'
import { colorCss, colorValueSchema } from '../tokens'
import type { PrimitiveDefinition, RenderContext } from '../types'

const iconName = z.string().min(1).max(40)

/* ---------- timeline ---------- */

const timelineProps = z.strictObject({
  items: z.array(z.strictObject({
    label: z.string().min(1).max(40).optional(),
    title: z.string().min(1).max(120),
    text: z.string().min(1).max(300).optional(),
    icon: iconName.optional(),
  })).min(2).max(8),
  orientation: z.enum(['horizontal', 'vertical']).optional(),
  variant: z.enum(['line', 'cards']).optional(),
  highlight: z.number().int().min(0).optional(),
  stagger: z.boolean().optional(),
})

export const timelinePrimitive: PrimitiveDefinition<z.infer<typeof timelineProps>> = {
  type: 'timeline',
  category: 'narrative',
  repair: (props) => (Array.isArray(props.items)
    ? { ...props, items: props.items.map((item) => (typeof item === 'string' ? { title: item } : item)) }
    : props),
  summary: 'Milestones or phases along a horizontal or vertical line; label is the date or phase marker.',
  guidance: 'Roadmaps, histories and plans. highlight marks the current milestone. Vertical suits 5+ items with text.',
  props: timelineProps,
  example: {
    type: 'timeline',
    highlight: 1,
    items: [
      { label: 'Q1', title: 'Pilot', text: 'Two sites' },
      { label: 'Q2', title: 'Rollout', text: 'All regions' },
      { label: 'Q4', title: 'Scale', icon: 'rocket' },
    ],
  },
  render(block, context) {
    const orientation = block.orientation ?? (block.items.length > 5 ? 'vertical' : 'horizontal')
    const node = el(context, 'ol', `ms-timeline ms-timeline--${orientation} ms-timeline--${block.variant ?? 'line'}`)
    setVars(node, { '--ms-count': block.items.length })
    block.items.forEach((item, index) => {
      const li = el(context, 'li', 'ms-timeline__item')
      if (block.highlight === index) li.classList.add('ms-timeline__item--active')
      else if (block.highlight !== undefined && index < block.highlight) li.classList.add('ms-timeline__item--done')
      stagger(li, block.stagger)
      const marker = el(context, 'span', 'ms-timeline__marker')
      marker.setAttribute('aria-hidden', 'true')
      if (item.icon) marker.appendChild(icon(context, item.icon))
      li.appendChild(marker)
      const body = el(context, 'div', 'ms-timeline__body')
      if (item.label) body.appendChild(el(context, 'span', 'ms-timeline__label', item.label))
      body.appendChild(rich(context, 'strong', 'ms-timeline__title', item.title))
      if (item.text) body.appendChild(rich(context, 'span', 'ms-timeline__text', item.text))
      li.appendChild(body)
      node.appendChild(li)
    })
    return node
  },
  outline: (block) => block.items.map((item) => [item.label, plainText(item.title)].filter(Boolean).join(' ')).join(' → '),
}

/* ---------- diagram ---------- */

const diagramKinds = ['flow', 'cycle', 'pyramid', 'funnel', 'matrix', 'venn', 'hub'] as const

const diagramItem = z.strictObject({
  label: z.string().min(1).max(60),
  text: z.string().min(1).max(200).optional(),
  icon: iconName.optional(),
  color: colorValueSchema.optional(),
})

const diagramProps = z.strictObject({
  kind: z.enum(diagramKinds),
  items: z.array(diagramItem).min(2).max(8),
  center: z.string().min(1).max(40).optional(),
  axes: z.strictObject({ x: z.string().min(1).max(40).optional(), y: z.string().min(1).max(40).optional() }).optional(),
  direction: z.enum(['horizontal', 'vertical']).optional(),
  stagger: z.boolean().optional(),
}).superRefine((diagram, context) => {
  if (diagram.kind === 'matrix' && diagram.items.length !== 4) {
    context.addIssue({ code: 'custom', path: ['items'], message: 'A matrix needs exactly 4 items (top-left, top-right, bottom-left, bottom-right).' })
  }
  if (diagram.kind === 'venn' && diagram.items.length > 3) {
    context.addIssue({ code: 'custom', path: ['items'], message: 'A venn diagram takes 2 or 3 items.' })
  }
  if ((diagram.kind === 'pyramid' || diagram.kind === 'funnel') && diagram.items.length > 6) {
    context.addIssue({ code: 'custom', path: ['items'], message: 'Pyramids and funnels take up to 6 levels.' })
  }
})

type DiagramBlock = z.infer<typeof diagramProps>

function itemColor(item: DiagramBlock['items'][number], index: number): string {
  return item.color ? colorCss(item.color) : `var(--ms-chart-${(index % 6) + 1})`
}

function diagramNode(context: RenderContext, block: DiagramBlock, item: DiagramBlock['items'][number], index: number, className = 'ms-diagram__node'): HTMLElement {
  const node = el(context, 'div', className)
  node.style.setProperty('--ms-node-color', itemColor(item, index))
  stagger(node, block.stagger, block.kind === 'flow' ? 'fade-right' : 'fade-in')
  if (item.icon) node.appendChild(icon(context, item.icon, 'ms-icon ms-diagram__icon'))
  node.appendChild(rich(context, 'strong', 'ms-diagram__label', item.label))
  if (item.text) node.appendChild(rich(context, 'span', 'ms-diagram__text', item.text))
  return node
}

/** Positions items evenly on a circle (percent coordinates inside a square). */
function circlePositions(count: number, radius: number): Array<{ x: number; y: number }> {
  return Array.from({ length: count }, (_, index) => {
    const angle = -Math.PI / 2 + (index / count) * Math.PI * 2
    return { x: 50 + Math.cos(angle) * radius, y: 50 + Math.sin(angle) * radius }
  })
}

function renderRing(context: RenderContext, block: DiagramBlock, arrows: boolean): HTMLElement {
  const node = el(context, 'div', `ms-diagram__ring ms-diagram__ring--${arrows ? 'cycle' : 'hub'}`)
  const ring = el(context, 'div', 'ms-diagram__orbit')
  ring.setAttribute('aria-hidden', 'true')
  node.appendChild(ring)
  if (block.center || !arrows) {
    const center = el(context, 'div', 'ms-diagram__center')
    center.appendChild(el(context, 'strong', undefined, block.center ?? ''))
    node.appendChild(center)
  }
  circlePositions(block.items.length, 40).forEach((position, index) => {
    const item = diagramNode(context, block, block.items[index], index, 'ms-diagram__node ms-diagram__node--orbit')
    setVars(item, { '--ms-x': `${position.x}%`, '--ms-y': `${position.y}%` })
    node.appendChild(item)
  })
  return node
}

function renderLevels(context: RenderContext, block: DiagramBlock, kind: 'pyramid' | 'funnel'): HTMLElement {
  const node = el(context, 'div', `ms-diagram__levels ms-diagram__levels--${kind}`)
  const count = block.items.length
  block.items.forEach((item, index) => {
    const row = el(context, 'div', 'ms-diagram__level')
    stagger(row, block.stagger)
    // Pyramids widen toward the base; funnels narrow toward the bottom.
    const step = kind === 'pyramid' ? (index + 1) / count : (count - index) / count
    setVars(row, { '--ms-level-width': `${(34 + step * 66).toFixed(1)}%`, '--ms-node-color': itemColor(item, index) })
    const shape = el(context, 'div', 'ms-diagram__shape')
    if (item.icon) shape.appendChild(icon(context, item.icon, 'ms-icon ms-diagram__icon'))
    shape.appendChild(rich(context, 'strong', 'ms-diagram__label', item.label))
    row.appendChild(shape)
    if (item.text) row.appendChild(rich(context, 'span', 'ms-diagram__aside', item.text))
    node.appendChild(row)
  })
  return node
}

function renderMatrix(context: RenderContext, block: DiagramBlock): HTMLElement {
  const node = el(context, 'div', 'ms-diagram__matrix')
  const quadrants = el(context, 'div', 'ms-diagram__quadrants')
  block.items.slice(0, 4).forEach((item, index) => quadrants.appendChild(diagramNode(context, block, item, index, 'ms-diagram__quadrant')))
  node.appendChild(quadrants)
  if (block.axes?.y) node.appendChild(el(context, 'span', 'ms-diagram__axis ms-diagram__axis--y', block.axes.y))
  if (block.axes?.x) node.appendChild(el(context, 'span', 'ms-diagram__axis ms-diagram__axis--x', block.axes.x))
  return node
}

function renderVenn(context: RenderContext, block: DiagramBlock): HTMLElement {
  const node = el(context, 'div', `ms-diagram__venn ms-diagram__venn--${block.items.length}`)
  block.items.slice(0, 3).forEach((item, index) => {
    const circle = diagramNode(context, block, item, index, 'ms-diagram__circle')
    circle.classList.add(`ms-diagram__circle--${index + 1}`)
    node.appendChild(circle)
  })
  if (block.center) node.appendChild(el(context, 'strong', 'ms-diagram__overlap', block.center))
  return node
}

function renderFlow(context: RenderContext, block: DiagramBlock): HTMLElement {
  const direction = block.direction ?? 'horizontal'
  const node = el(context, 'div', `ms-diagram__flow ms-diagram__flow--${direction}`)
  block.items.forEach((item, index) => {
    if (index > 0) {
      const arrow = el(context, 'span', 'ms-diagram__arrow')
      arrow.setAttribute('aria-hidden', 'true')
      arrow.appendChild(icon(context, 'arrow-right'))
      stagger(arrow, block.stagger, 'fade-in')
      node.appendChild(arrow)
    }
    const step = diagramNode(context, block, item, index)
    step.appendChild(el(context, 'span', 'ms-diagram__step', String(index + 1)))
    node.appendChild(step)
  })
  return node
}

/** Keeps a diagram whose item count does not fit its kind by switching to a kind that does. */
function repairDiagram(props: Record<string, unknown>, note: (message: string) => void): Record<string, unknown> {
  const next = { ...props }
  if (Array.isArray(next.items)) {
    const items = next.items.map((item) => (typeof item === 'string' ? { label: item } : item))
    next.items = items
    const count = items.length
    if (next.kind === 'matrix' && count !== 4) {
      next.kind = count <= 6 ? 'flow' : 'hub'
      note('A matrix needs 4 items; drew the diagram as a ' + String(next.kind) + ' instead.')
    }
    if (next.kind === 'venn' && count > 3) {
      next.kind = 'hub'
      note('A venn diagram takes up to 3 sets; drew the diagram as a hub instead.')
    }
    if ((next.kind === 'pyramid' || next.kind === 'funnel') && count > 6) {
      next.items = items.slice(0, 6)
      note('Kept the first 6 levels.')
    }
  }
  return next
}

export const diagramPrimitive: PrimitiveDefinition<DiagramBlock> = {
  type: 'diagram',
  category: 'narrative',
  repair: repairDiagram,
  summary: 'Concept diagrams: flow (process steps), cycle, hub (center + satellites), pyramid, funnel, 2×2 matrix, venn.',
  guidance: 'flow: 2-6 sequential steps. cycle/hub: 3-8 items around an optional center label. pyramid/funnel: 2-6 levels (pyramid top → base, funnel top → bottom). matrix: exactly 4 quadrants in reading order with axes labels. venn: 2-3 sets, center names the overlap.',
  props: diagramProps,
  example: {
    type: 'diagram',
    kind: 'cycle',
    center: 'Flywheel',
    items: [
      { label: 'Better product', icon: 'sparkles' },
      { label: 'More users', icon: 'users' },
      { label: 'More data', icon: 'database' },
      { label: 'Smarter models', icon: 'brain' },
    ],
  },
  render(block, context) {
    const node = el(context, 'div', `ms-diagram ms-diagram--${block.kind}`)
    node.setAttribute('role', 'group')
    node.setAttribute('aria-label', `${block.kind} diagram: ${block.items.map((item) => item.label).join(', ')}`)
    switch (block.kind) {
      case 'cycle': node.appendChild(renderRing(context, block, true)); break
      case 'hub': node.appendChild(renderRing(context, block, false)); break
      case 'pyramid': node.appendChild(renderLevels(context, block, 'pyramid')); break
      case 'funnel': node.appendChild(renderLevels(context, block, 'funnel')); break
      case 'matrix': node.appendChild(renderMatrix(context, block)); break
      case 'venn': node.appendChild(renderVenn(context, block)); break
      default: node.appendChild(renderFlow(context, block))
    }
    return node
  },
  outline: (block) => `${block.kind}: ${block.items.map((item) => item.label).join(' / ')}`,
}

export const narrativePrimitives = [timelinePrimitive, diagramPrimitive]
