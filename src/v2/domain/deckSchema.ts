import { z } from 'zod'

import { isSafeLinkUrl } from '../../presentation/imageUrl'
import { isSafeImageUrl } from '../render/urls'
import { BLOCK_ID_PATTERN } from '../catalog/registry'
import { colorValueSchema, spaceSchema } from '../catalog/tokens'
import type { Block } from '../catalog/types'
import { gradientPresets, themeSchema } from '../render/theme'

/**
 * The v2 deck document. Slides hold primitive blocks (validated through the
 * primitive registry, see normalizeDeck) plus slide-level presentation
 * settings. Every field is data: nothing here is ever interpreted as markup.
 */

export const DECK_VERSION = 2
export const MAX_SLIDES = 60
export const MAX_TOP_LEVEL_BLOCKS = 24

export const revealTransitions = ['none', 'fade', 'slide', 'convex', 'concave', 'zoom'] as const

const safeImageUrl = z.string().min(1).max(2_000).refine(isSafeImageUrl, 'Unsafe image URL.')
const safeLinkUrl = z.string().min(1).max(2_000).refine(isSafeLinkUrl, 'Unsafe source URL.')

export const slideIdSchema = z.string().regex(BLOCK_ID_PATTERN, 'Slide ids use letters, digits, - and _ (max 64).')

export const backgroundSchema = z.strictObject({
  color: colorValueSchema.optional(),
  gradient: z.union([
    z.enum(gradientPresets),
    z.strictObject({
      from: colorValueSchema,
      to: colorValueSchema,
      angle: z.number().int().min(0).max(360).optional(),
      kind: z.enum(['linear', 'radial']).optional(),
    }),
  ]).optional(),
  image: z.strictObject({
    src: safeImageUrl,
    alt: z.string().min(1).max(300).optional(),
    position: z.enum(['center', 'top', 'bottom', 'left', 'right']).optional(),
    fit: z.enum(['cover', 'contain']).optional(),
    overlay: z.enum(['none', 'dim', 'dark', 'light', 'gradient', 'accent']).optional(),
  }).optional(),
  pattern: z.enum(['none', 'glow', 'grid', 'dots', 'mesh', 'noise']).optional(),
})

export const sourceSchema = z.strictObject({
  title: z.string().min(1).max(200),
  url: safeLinkUrl,
})

/** Slide fields other than blocks; blocks are validated per primitive. */
export const slideShape = {
  id: slideIdSchema,
  name: z.string().min(1).max(120).optional(),
  align: z.enum(['top', 'center', 'bottom']).optional(),
  padding: spaceSchema.optional(),
  gap: spaceSchema.optional(),
  tone: z.enum(['default', 'inverse', 'accent']).optional(),
  background: backgroundSchema.optional(),
  transition: z.enum(revealTransitions).optional(),
  autoAnimate: z.boolean().optional(),
  notes: z.string().max(5_000).optional(),
  sources: z.array(sourceSchema).max(8).optional(),
}

export const settingsSchema = z.strictObject({
  aspectRatio: z.enum(['16:9', '4:3']).optional(),
  transition: z.enum(revealTransitions).optional(),
  transitionSpeed: z.enum(['default', 'fast', 'slow']).optional(),
  controls: z.boolean().optional(),
  progress: z.boolean().optional(),
  slideNumber: z.boolean().optional(),
  autoFit: z.boolean().optional(),
})

export const deckMetaShape = {
  title: z.string().min(1).max(200).optional(),
  language: z.string().max(35).regex(/^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$/, 'Language must be a BCP 47 tag.').optional(),
  theme: themeSchema.optional(),
  settings: settingsSchema.optional(),
}

export interface Slide {
  id: string
  name?: string
  align?: 'top' | 'center' | 'bottom'
  padding?: z.infer<typeof spaceSchema>
  gap?: z.infer<typeof spaceSchema>
  tone?: 'default' | 'inverse' | 'accent'
  background?: z.infer<typeof backgroundSchema>
  transition?: (typeof revealTransitions)[number]
  autoAnimate?: boolean
  notes?: string
  sources?: Array<z.infer<typeof sourceSchema>>
  blocks: Block[]
}

export interface Deck {
  version: 2
  title?: string
  language?: string
  theme?: z.infer<typeof themeSchema>
  settings?: z.infer<typeof settingsSchema>
  slides: Slide[]
}

export type SlideBackground = z.infer<typeof backgroundSchema>
export type DeckSettings = z.infer<typeof settingsSchema>

export function deckTitle(deck: Pick<Deck, 'title' | 'slides'>): string {
  if (deck.title?.trim()) return deck.title.trim()
  for (const slide of deck.slides) {
    if (slide.name?.trim()) return slide.name.trim()
  }
  return 'Presentation'
}
