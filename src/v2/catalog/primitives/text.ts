import { z } from 'zod'

import { el, icon, rich, setVars, stagger } from '../dom'
import { plainText } from '../richText'
import { isSafeImageUrl } from '../../render/urls'
import { alignSchema, spaceScale, spaceSchema, textScale, textSizeSchema, toneCss, toneSchema } from '../tokens'
import type { PrimitiveDefinition } from '../types'

const richText = (max: number) => z.string().min(1).max(max)
const iconName = z.string().min(1).max(40)

const headingProps = z.strictObject({
  text: richText(300),
  level: z.number().int().min(1).max(4).optional(),
  size: textSizeSchema.optional(),
  align: alignSchema.optional(),
  tone: toneSchema.optional(),
  gradient: z.boolean().optional(),
})

const headingSizes = { 1: '3xl', 2: '2xl', 3: 'xl', 4: 'lg' } as const

export const headingPrimitive: PrimitiveDefinition<z.infer<typeof headingProps>> = {
  type: 'heading',
  category: 'text',
  summary: 'A title or subtitle. Level 1 is the slide hero, 2 the usual slide title, 3-4 card or column titles.',
  guidance: 'Write takeaway titles (a full claim, not a topic label). Wrap the key phrase in ==…== to color it with the accent. gradient paints the whole heading with the accent gradient.',
  props: headingProps,
  example: { type: 'heading', text: 'Solar is now the **cheapest** power in ==most markets==', level: 2 },
  render(block, context) {
    const level = block.level ?? 2
    const node = rich(context, `h${level}` as 'h1' | 'h2' | 'h3' | 'h4', `ms-heading ms-heading--l${level}`, block.text)
    setVars(node, {
      '--ms-font-size': textScale[block.size ?? headingSizes[level as 1 | 2 | 3 | 4]],
      '--ms-color': block.tone ? toneCss(block.tone) : undefined,
      '--ms-text-align': alignText(block.align),
    })
    if (block.gradient) node.classList.add('ms-heading--gradient')
    return node
  },
  outline: (block) => plainText(block.text),
}

function alignText(align: 'start' | 'center' | 'end' | undefined): string | undefined {
  if (!align) return undefined
  return align === 'start' ? 'left' : align === 'end' ? 'right' : 'center'
}

const textProps = z.strictObject({
  text: richText(2_000),
  variant: z.enum(['body', 'lead', 'eyebrow', 'caption', 'label']).optional(),
  size: textSizeSchema.optional(),
  align: alignSchema.optional(),
  tone: toneSchema.optional(),
  weight: z.enum(['regular', 'medium', 'semibold', 'bold']).optional(),
})

const textVariantSizes = { body: 'md', lead: 'lg', eyebrow: 'sm', caption: 'xs', label: 'sm' } as const
const weights = { regular: 400, medium: 500, semibold: 600, bold: 700 } as const

export const textPrimitive: PrimitiveDefinition<z.infer<typeof textProps>> = {
  type: 'text',
  category: 'text',
  summary: 'Paragraph text. Variants: body, lead (large intro), eyebrow (small uppercase kicker), caption, label.',
  guidance: 'A blank line starts a new paragraph; a single newline is a line break. Keep slide text short; long explanations go in speaker notes.',
  props: textProps,
  example: { type: 'text', text: 'Market overview', variant: 'eyebrow', tone: 'accent' },
  render(block, context) {
    const variant = block.variant ?? 'body'
    const node = el(context, 'div', `ms-text ms-text--${variant}`)
    for (const paragraph of block.text.split(/\n\s*\n/)) {
      if (paragraph.trim()) node.appendChild(rich(context, 'p', 'ms-text__p', paragraph.trim()))
    }
    setVars(node, {
      '--ms-font-size': textScale[block.size ?? textVariantSizes[variant]],
      '--ms-color': block.tone ? toneCss(block.tone) : undefined,
      '--ms-text-align': alignText(block.align),
      '--ms-weight': block.weight ? weights[block.weight] : undefined,
    })
    return node
  },
  outline: (block) => plainText(block.text),
}

const listItem = z.union([
  richText(400),
  z.strictObject({ text: richText(400), description: z.string().min(1).max(400).optional(), icon: iconName.optional() }),
])

const listProps = z.strictObject({
  items: z.array(listItem).min(1).max(10),
  style: z.enum(['bullet', 'number', 'check', 'cross', 'arrow', 'dash', 'icon', 'none']).optional(),
  columns: z.number().int().min(1).max(3).optional(),
  size: textSizeSchema.optional(),
  gap: spaceSchema.optional(),
  tone: toneSchema.optional(),
  stagger: z.boolean().optional(),
})

const markerIcons = { check: 'check', cross: 'x', arrow: 'arrow-right' } as const

export const listPrimitive: PrimitiveDefinition<z.infer<typeof listProps>> = {
  type: 'list',
  category: 'text',
  summary: 'A bulleted, numbered, checklist or icon list; items may carry a description and an icon.',
  guidance: 'Two to six short items. style "icon" uses each item\'s icon. stagger reveals items one at a time. tone colors the markers.',
  props: listProps,
  example: {
    type: 'list',
    style: 'check',
    stagger: true,
    items: ['Protect one focus hour', { text: 'Write three priorities', description: 'Every morning, before email' }],
  },
  render(block, context) {
    const style = block.style ?? 'bullet'
    const node = el(context, style === 'number' ? 'ol' : 'ul', `ms-list ms-list--${style}`)
    setVars(node, {
      '--ms-font-size': textScale[block.size ?? 'md'],
      '--ms-gap': spaceScale[block.gap ?? 'sm'],
      '--ms-columns': block.columns ?? 1,
      '--ms-marker': block.tone ? toneCss(block.tone) : undefined,
    })
    block.items.forEach((item, index) => {
      const entry = typeof item === 'string' ? { text: item } : item
      const li = el(context, 'li', 'ms-list__item')
      stagger(li, block.stagger)
      const marker = el(context, 'span', 'ms-list__marker')
      marker.setAttribute('aria-hidden', 'true')
      if (style === 'number') marker.textContent = String(index + 1).padStart(2, '0')
      else if (style === 'icon') marker.appendChild(icon(context, 'icon' in entry && entry.icon ? entry.icon : 'check'))
      else if (style in markerIcons) marker.appendChild(icon(context, markerIcons[style as keyof typeof markerIcons]))
      if (style !== 'none') li.appendChild(marker)
      const body = el(context, 'div', 'ms-list__body')
      body.appendChild(rich(context, 'span', 'ms-list__text', entry.text))
      if ('description' in entry && entry.description) body.appendChild(rich(context, 'span', 'ms-list__description', entry.description))
      li.appendChild(body)
      node.appendChild(li)
    })
    return node
  },
  outline: (block) => block.items.map((item) => plainText(typeof item === 'string' ? item : item.text)).join(' · '),
}

const quoteProps = z.strictObject({
  text: richText(600),
  attribution: z.string().min(1).max(160).optional(),
  role: z.string().min(1).max(160).optional(),
  avatar: z.string().max(2_000).optional(),
  variant: z.enum(['plain', 'large', 'card']).optional(),
  align: alignSchema.optional(),
})

export const quotePrimitive: PrimitiveDefinition<z.infer<typeof quoteProps>> = {
  type: 'quote',
  category: 'text',
  summary: 'A quotation or testimonial with attribution, role and optional avatar image.',
  guidance: 'Only quote real, verifiable words and attribute them; never invent quotes from real people.',
  props: quoteProps,
  example: { type: 'quote', text: 'The best way to predict the future is to invent it.', attribution: 'Alan Kay', variant: 'large' },
  render(block, context) {
    const node = el(context, 'figure', `ms-quote ms-quote--${block.variant ?? 'plain'}${block.align ? ` ms-quote--align-${block.align}` : ''}`)
    setVars(node, { '--ms-text-align': alignText(block.align) })
    const mark = icon(context, 'quote', 'ms-icon ms-quote__mark')
    node.appendChild(mark)
    const blockquote = el(context, 'blockquote', 'ms-quote__text')
    blockquote.appendChild(rich(context, 'p', '', block.text))
    node.appendChild(blockquote)
    if (block.attribution || block.role) {
      const caption = el(context, 'figcaption', 'ms-quote__caption')
      if (block.avatar) {
        if (isSafeImageUrl(block.avatar)) {
          const img = el(context, 'img', 'ms-quote__avatar')
          img.setAttribute('data-src', block.avatar)
          img.alt = ''
          img.referrerPolicy = 'no-referrer'
          caption.appendChild(img)
        } else {
          context.report('unsafe-url', 'Unsafe avatar URL omitted.')
        }
      }
      const who = el(context, 'span', 'ms-quote__who')
      if (block.attribution) who.appendChild(el(context, 'strong', 'ms-quote__name', block.attribution))
      if (block.role) who.appendChild(el(context, 'span', 'ms-quote__role', block.role))
      caption.appendChild(who)
      node.appendChild(caption)
    }
    return node
  },
  outline: (block) => `“${plainText(block.text)}”${block.attribution ? ` — ${block.attribution}` : ''}`,
}

const calloutTones = ['info', 'success', 'warning', 'danger', 'accent', 'neutral'] as const
const calloutIcons = { info: 'info', success: 'check-circle', warning: 'warning', danger: 'alert', accent: 'sparkles', neutral: 'lightbulb' } as const

const calloutProps = z.strictObject({
  text: richText(600),
  title: z.string().min(1).max(120).optional(),
  tone: z.enum(calloutTones).optional(),
  icon: iconName.optional(),
})

export const calloutPrimitive: PrimitiveDefinition<z.infer<typeof calloutProps>> = {
  type: 'callout',
  category: 'text',
  summary: 'A highlighted note, tip, warning or key takeaway with an icon.',
  props: calloutProps,
  example: { type: 'callout', tone: 'accent', title: 'Key takeaway', text: 'Costs fell **90%** in a decade.' },
  render(block, context) {
    const tone = block.tone ?? 'info'
    const node = el(context, 'aside', `ms-callout ms-callout--${tone}`)
    node.appendChild(icon(context, block.icon ?? calloutIcons[tone], 'ms-icon ms-callout__icon'))
    const body = el(context, 'div', 'ms-callout__body')
    if (block.title) body.appendChild(el(context, 'strong', 'ms-callout__title', block.title))
    body.appendChild(rich(context, 'p', 'ms-callout__text', block.text))
    node.appendChild(body)
    return node
  },
  outline: (block) => [block.title, plainText(block.text)].filter(Boolean).join(': '),
}

const badgeProps = z.strictObject({
  text: z.string().min(1).max(60),
  tone: toneSchema.optional(),
  variant: z.enum(['soft', 'solid', 'outline']).optional(),
  icon: iconName.optional(),
})

export const badgePrimitive: PrimitiveDefinition<z.infer<typeof badgeProps>> = {
  type: 'badge',
  category: 'text',
  summary: 'A small pill label for tags, statuses, categories or dates.',
  props: badgeProps,
  example: { type: 'badge', text: 'Beta', tone: 'accent', variant: 'soft', icon: 'sparkles' },
  render(block, context) {
    const node = el(context, 'span', `ms-badge ms-badge--${block.variant ?? 'soft'}`)
    setVars(node, { '--ms-badge-color': toneCss(block.tone ?? 'accent') })
    if (block.icon) node.appendChild(icon(context, block.icon))
    node.appendChild(el(context, 'span', undefined, block.text))
    return node
  },
  outline: (block) => `[${block.text}]`,
}

const dividerProps = z.strictObject({
  variant: z.enum(['line', 'dashed', 'gradient', 'dots']).optional(),
  spacing: spaceSchema.optional(),
})

export const dividerPrimitive: PrimitiveDefinition<z.infer<typeof dividerProps>> = {
  type: 'divider',
  category: 'text',
  summary: 'A horizontal rule that separates groups of content.',
  props: dividerProps,
  example: { type: 'divider', variant: 'gradient' },
  render(block, context) {
    const node = el(context, 'hr', `ms-divider ms-divider--${block.variant ?? 'line'}`)
    setVars(node, { '--ms-divider-space': spaceScale[block.spacing ?? 'xs'] })
    return node
  },
}

const spacerProps = z.strictObject({
  size: z.union([spaceSchema, z.literal('flex')]).optional(),
})

export const spacerPrimitive: PrimitiveDefinition<z.infer<typeof spacerProps>> = {
  type: 'spacer',
  category: 'text',
  summary: 'Empty space; size "flex" pushes following content to the end of its container.',
  props: spacerProps,
  example: { type: 'spacer', size: 'flex' },
  render(block, context) {
    const node = el(context, 'div', 'ms-spacer')
    node.setAttribute('aria-hidden', 'true')
    if (block.size === 'flex') node.classList.add('ms-spacer--flex')
    else setVars(node, { '--ms-spacer': spaceScale[block.size ?? 'md'] })
    return node
  },
}

export const textPrimitives = [headingPrimitive, textPrimitive, listPrimitive, quotePrimitive, calloutPrimitive, badgePrimitive, dividerPrimitive, spacerPrimitive]
