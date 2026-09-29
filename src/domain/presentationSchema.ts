import { z } from 'zod'

import { createAppError, type GenerationError } from '../lib/errors'
import { containsLegacyRawHtml } from '../presentation/legacyContentBoundary'
import { isSafeImageUrl, isSafeLinkUrl } from '../presentation/imageUrl'

// Keep these contracts aligned with the presentation agent's action schemas.
// public/templates/showcase.json exercises every field.
export const slideLayouts = ['title', 'section', 'content', 'split', 'statement', 'quote', 'stats', 'comparison', 'timeline', 'closing'] as const
export const deckThemes = ['midnight', 'aurora', 'ember', 'ocean', 'forest', 'paper'] as const
export const revealTransitions = ['none', 'fade', 'slide', 'convex', 'concave', 'zoom'] as const

export type SlideLayout = (typeof slideLayouts)[number]
export type DeckTheme = (typeof deckThemes)[number]

const safeBackgroundImageUrlSchema = z.string().max(2_000).refine(isSafeImageUrl, 'Unsafe background image URL.')
const safeLinkUrlSchema = z.string().max(2_000).refine(isSafeLinkUrl, 'Unsafe source URL.')
const requiredText = (max: number) => z.string().min(1).max(max)

export const safeAttributesSchema = z.record(z.string(), z.string().max(500)).superRefine((attributes, context) => {
  for (const [key, value] of Object.entries(attributes)) {
    const allowed = key === 'data-auto-animate' || key === 'data-transition' || key === 'data-background-color'
    if (!allowed || /^on/i.test(key) || /javascript:/i.test(value)) {
      context.addIssue({ code: 'custom', message: `Unsafe generated attribute: ${key}`, path: [key] })
    }
  }
})

export const safeRevealOptionKeys = new Set(['controls', 'progress', 'transition', 'center', 'slideNumber'])

export const safeRevealOptionsSchema = z.strictObject({
  controls: z.boolean().optional(),
  progress: z.boolean().optional(),
  center: z.boolean().optional(),
  slideNumber: z.boolean().optional(),
  transition: z.enum(revealTransitions).optional(),
})

export const slideImageSchema = z.strictObject({
  url: safeBackgroundImageUrlSchema,
  alt: requiredText(300),
  caption: z.string().max(200).optional(),
  position: z.enum(['left', 'right']).optional(),
})

export const slideSourceSchema = z.strictObject({
  title: requiredText(200),
  url: safeLinkUrlSchema,
})

export const slideSchema = z.strictObject({
  layout: z.enum(slideLayouts).optional(),
  kicker: z.string().max(80).optional(),
  title: z.string().max(500).optional(),
  subtitle: z.string().max(300).optional(),
  content: z.string().max(5_000).optional().superRefine((value, context) => {
    if (value && containsLegacyRawHtml(value)) {
      context.addIssue({ code: 'custom', message: 'unsafe-legacy-content: raw HTML is rejected by default validation.' })
    }
  }),
  notes: z.string().max(5_000).optional(),
  // URL/image-only aliases. Color support is intentionally limited to
  // attributes['data-background-color'] until a dedicated backgroundColor field exists.
  background: safeBackgroundImageUrlSchema.optional(),
  backgroundImage: safeBackgroundImageUrlSchema.optional(),
  image: slideImageSchema.optional(),
  stats: z.array(z.strictObject({ value: requiredText(24), label: requiredText(160) })).min(1).max(4).optional(),
  columns: z.array(z.strictObject({ heading: requiredText(120), content: z.string().max(1_500).optional() })).min(2).max(3).optional(),
  timeline: z.array(z.strictObject({ label: requiredText(60), text: requiredText(300) })).min(2).max(6).optional(),
  quote: z.strictObject({ text: requiredText(600), attribution: z.string().max(200).optional() }).optional(),
  code: z.strictObject({
    language: z.string().max(30).regex(/^[a-z0-9][a-z0-9+#.-]{0,29}$/, 'Unsupported code language name.').optional(),
    source: requiredText(4_000),
  }).optional(),
  sources: z.array(slideSourceSchema).max(6).optional(),
  fragments: z.boolean().optional(),
  attributes: safeAttributesSchema.optional(),
})

export const deckSettingsShape = {
  title: z.string().max(200).optional(),
  language: z.string().max(35).regex(/^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$/, 'Language must be a BCP 47 tag.').optional(),
  theme: z.enum(deckThemes).optional(),
  plugins: z.array(z.enum(['highlight', 'notes'])).optional(),
  revealOptions: safeRevealOptionsSchema.optional(),
}

export const presentationConfigSchema = z.strictObject({
  slides: z.array(slideSchema).min(1).max(50),
  ...deckSettingsShape,
})

export type ValidatedPresentationConfig = z.infer<typeof presentationConfigSchema>
export type ValidatedSlide = z.infer<typeof slideSchema>
export type SafeRevealOptionsInput = z.input<typeof safeRevealOptionsSchema>

export function validatePresentation(input: unknown):
  | { ok: true; data: ValidatedPresentationConfig }
  | { ok: false; error: GenerationError } {
  const result = presentationConfigSchema.safeParse(input)
  if (result.success) return { ok: true, data: result.data }

  const diagnostics = result.error.issues.map((issue) => ({
    code: issue.code,
    path: issue.path.join('.'),
    message: issue.message,
  }))
  const hasPluginIssue = diagnostics.some((diagnostic) => diagnostic.path.startsWith('plugins'))
  const hasLegacyIssue = diagnostics.some((diagnostic) => diagnostic.message.includes('unsafe-legacy-content'))

  return {
    ok: false,
    error: createAppError({
      category: hasLegacyIssue ? 'unsafe-legacy-content' : hasPluginIssue ? 'plugin' : 'validation',
      diagnostics,
    }) as GenerationError,
  }
}

/** Deck title shown in the toolbar, exports and session list. */
export function deckTitle(deck: Pick<ValidatedPresentationConfig, 'title' | 'slides'>): string {
  return deck.title?.trim() || deck.slides.find((slide) => slide.title?.trim())?.title?.trim() || 'Presentation'
}

/** Code slides need the highlight plugin even when a generated deck omits it. */
export function effectivePlugins(deck: Pick<ValidatedPresentationConfig, 'plugins' | 'slides'>): Array<'highlight' | 'notes'> {
  const plugins = new Set(deck.plugins ?? [])
  if (deck.slides.some((slide) => slide.code)) plugins.add('highlight')
  return [...plugins]
}
