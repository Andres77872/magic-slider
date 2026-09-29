import type { z } from 'zod'

import type { presentationConfigSchema, safeRevealOptionsSchema, slideSchema } from './presentationSchema'
import type { presentationActionSchema, presentationToolNameSchema } from './presentationActions'

export type ValidatedSlide = z.infer<typeof slideSchema>
export type ValidatedPresentationConfig = z.infer<typeof presentationConfigSchema>
export type SafeRevealOptionsInput = z.input<typeof safeRevealOptionsSchema>
export type SafeRevealOptions = z.infer<typeof safeRevealOptionsSchema>
export type PresentationAction = z.infer<typeof presentationActionSchema>
export type PresentationToolName = z.infer<typeof presentationToolNameSchema>
