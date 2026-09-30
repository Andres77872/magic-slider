import { z } from 'zod'

import { el, setVars } from '../dom'
import { alignFlex, alignSchema, colorCss, colorValueSchema, isHexColor, radiusScale, radiusSchema, spaceScale, spaceSchema } from '../tokens'
import { surfaceVariables } from '../../render/theme'
import type { PrimitiveDefinition } from '../types'

const justifyValues = { start: 'flex-start', center: 'center', end: 'flex-end', between: 'space-between', around: 'space-around', evenly: 'space-evenly' } as const

const stackProps = z.strictObject({
  direction: z.enum(['vertical', 'horizontal']).optional(),
  gap: spaceSchema.optional(),
  align: z.enum(['start', 'center', 'end', 'stretch']).optional(),
  justify: z.enum(['start', 'center', 'end', 'between', 'around', 'evenly']).optional(),
  wrap: z.boolean().optional(),
})

export const stackPrimitive: PrimitiveDefinition<z.infer<typeof stackProps>> = {
  type: 'stack',
  category: 'layout',
  container: true,
  summary: 'Arranges children in a vertical column or horizontal row.',
  guidance: 'The default building block for grouping. Use direction "horizontal" for inline rows such as badges or icon + text.',
  props: stackProps,
  example: {
    type: 'stack',
    direction: 'horizontal',
    gap: 'sm',
    align: 'center',
    children: [
      { type: 'badge', text: 'New', tone: 'accent' },
      { type: 'text', text: 'Launching **Q3 2026**', size: 'lg' },
    ],
  },
  render(block, context) {
    const node = el(context, 'div', `ms-stack ms-stack--${block.direction ?? 'vertical'}`)
    setVars(node, {
      '--ms-gap': spaceScale[block.gap ?? 'md'],
      '--ms-align': alignFlex[block.align ?? (block.direction === 'horizontal' ? 'center' : 'stretch')],
      '--ms-justify': justifyValues[block.justify ?? 'start'],
    })
    if (block.wrap) node.classList.add('ms-stack--wrap')
    context.renderChildren(block.children ?? [], node)
    return node
  },
}

const GRID_TEMPLATE = /^(?:\d{1,2}(?:\.\d)?fr)(?:\s+\d{1,2}(?:\.\d)?fr){0,5}$/

const gridProps = z.strictObject({
  columns: z.union([z.number().int().min(1).max(6), z.string().regex(GRID_TEMPLATE, 'Use 1-6 columns or fr units such as "2fr 1fr".')]).optional(),
  gap: spaceSchema.optional(),
  align: z.enum(['start', 'center', 'end', 'stretch']).optional(),
})

export const gridPrimitive: PrimitiveDefinition<z.infer<typeof gridProps>> = {
  type: 'grid',
  category: 'layout',
  container: true,
  summary: 'Places children in equal columns, or in weighted columns such as "2fr 1fr".',
  guidance: 'Use for side-by-side layouts: text + image, comparison cards, KPI rows, feature grids. Children may set span (1-6) to cover several columns; items wrap into new rows.',
  props: gridProps,
  example: {
    type: 'grid',
    columns: '3fr 2fr',
    gap: 'lg',
    align: 'center',
    children: [
      { type: 'stack', children: [{ type: 'heading', text: 'Text on the left' }, { type: 'text', text: 'Weighted columns give the story more room.' }] },
      { type: 'image', src: 'https://images.example.com/photo.jpg', alt: 'Illustrative photo', aspect: '4:3' },
    ],
  },
  render(block, context) {
    const node = el(context, 'div', 'ms-grid')
    const children = block.children ?? []
    const template = typeof block.columns === 'string'
      ? block.columns
      : `repeat(${block.columns ?? Math.min(Math.max(children.length, 1), 4)}, minmax(0, 1fr))`
    setVars(node, {
      '--ms-grid-template': template,
      '--ms-gap': spaceScale[block.gap ?? 'md'],
      '--ms-align': alignFlex[block.align ?? 'stretch'],
    })
    context.renderChildren(children, node)
    return node
  },
}

const boxProps = z.strictObject({
  variant: z.enum(['card', 'plain', 'glass', 'outline', 'soft', 'accent', 'inverse']).optional(),
  padding: spaceSchema.optional(),
  radius: radiusSchema.optional(),
  gap: spaceSchema.optional(),
  align: alignSchema.optional(),
  justify: z.enum(['start', 'center', 'end', 'between']).optional(),
  color: colorValueSchema.optional(),
  accentBar: z.enum(['none', 'top', 'left']).optional(),
})

export const boxPrimitive: PrimitiveDefinition<z.infer<typeof boxProps>> = {
  type: 'box',
  category: 'layout',
  container: true,
  summary: 'A surface that frames its children: card, glass, outline, soft tint, solid accent or inverse panel.',
  guidance: 'Wrap related content into cards (features, comparison sides, callouts of numbers). "color" tints soft/accent/outline variants and the accent bar.',
  props: boxProps,
  example: {
    type: 'box',
    variant: 'card',
    accentBar: 'top',
    children: [
      { type: 'icon', name: 'rocket', variant: 'circle', tone: 'accent' },
      { type: 'heading', text: 'Faster launches', level: 3 },
      { type: 'text', text: 'Ship in weeks, not quarters.', tone: 'muted' },
    ],
  },
  render(block, context) {
    const variant = block.variant ?? 'card'
    const node = el(context, 'div', `ms-box ms-box--${variant}`)
    if (block.accentBar && block.accentBar !== 'none') node.classList.add(`ms-box--bar-${block.accentBar}`)
    setVars(node, {
      '--ms-box-padding': spaceScale[block.padding ?? (variant === 'plain' ? 'none' : 'md')],
      '--ms-box-radius': radiusScale[block.radius ?? 'lg'],
      '--ms-gap': spaceScale[block.gap ?? 'sm'],
      '--ms-box-color': block.color ? colorCss(block.color) : undefined,
      '--ms-align': alignFlex[block.align ?? 'start'],
      '--ms-text-align': block.align === 'end' ? 'right' : block.align ?? 'left',
      '--ms-justify': justifyValues[block.justify ?? 'start'],
    })
    if (variant === 'accent' || variant === 'inverse') {
      const surface = variant === 'inverse'
        ? context.theme.colors.text
        : block.color
          ? (isHexColor(block.color) ? block.color : context.theme.colors[block.color as keyof typeof context.theme.colors] ?? context.theme.colors.accent)
          : context.theme.colors.accent
      setVars(node, surfaceVariables(context.theme, surface, variant === 'accent'))
    }
    context.renderChildren(block.children ?? [], node)
    return node
  },
}

export const layoutPrimitives = [stackPrimitive, gridPrimitive, boxPrimitive]
