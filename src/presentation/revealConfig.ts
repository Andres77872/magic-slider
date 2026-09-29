import { safeRevealOptionsSchema } from '../domain/presentationSchema'

type SafeRevealTransition = 'none' | 'fade' | 'slide' | 'convex' | 'concave' | 'zoom'

export const appOwnedRevealOptions = {
  // A 16:9 canvas matches generated imagery and modern displays.
  width: 1280,
  height: 720,
  margin: 0.04,
  embedded: true,
  keyboard: true,
  keyboardCondition: 'focused',
  hash: false,
  history: false,
  respondToHashChanges: false,
  postMessage: false,
  postMessageEvents: false,
  scrollActivationWidth: 0,
  view: null,
} as const

export type SafeRevealConfig = typeof appOwnedRevealOptions & {
  plugins: unknown[]
  controls?: boolean
  progress?: boolean
  center?: boolean
  slideNumber?: boolean
  transition?: SafeRevealTransition
}

export type RevealConfigDiagnostic = {
  code: 'app-owned-reveal-option' | 'invalid-reveal-option' | 'unsupported-reveal-option'
  key: string
  message: string
}

type GeneratedRevealOptions = NonNullable<Parameters<typeof safeRevealOptionsSchema.safeParse>[0]>

const appOwnedRevealOptionKeys = new Set([
  ...Object.keys(appOwnedRevealOptions),
  'plugins',
])

const revealTransitionValues = new Set<SafeRevealTransition>(['none', 'fade', 'slide', 'convex', 'concave', 'zoom'])

function isRevealTransition(value: unknown): value is SafeRevealTransition {
  return typeof value === 'string' && revealTransitionValues.has(value as SafeRevealTransition)
}

export function normalizeGeneratedRevealOptions(generatedOptions: unknown): {
  options: Partial<Pick<SafeRevealConfig, 'controls' | 'progress' | 'center' | 'slideNumber' | 'transition'>>
  diagnostics: RevealConfigDiagnostic[]
} {
  const diagnostics: RevealConfigDiagnostic[] = []
  const options: Partial<Pick<SafeRevealConfig, 'controls' | 'progress' | 'center' | 'slideNumber' | 'transition'>> = {}

  if (generatedOptions == null) return { options, diagnostics }
  if (typeof generatedOptions !== 'object' || Array.isArray(generatedOptions)) {
    return {
      options,
      diagnostics: [
        { code: 'invalid-reveal-option', key: 'revealOptions', message: 'Reveal options must be an object.' },
      ],
    }
  }

  for (const [key, value] of Object.entries(generatedOptions)) {
    if (appOwnedRevealOptionKeys.has(key)) {
      diagnostics.push({
        code: 'app-owned-reveal-option',
        key,
        message: `Generated reveal option "${key}" is app-owned and was ignored.`,
      })
      continue
    }

    if (key === 'controls' || key === 'progress' || key === 'center' || key === 'slideNumber') {
      if (typeof value === 'boolean') {
        options[key] = value
      } else {
        diagnostics.push({ code: 'invalid-reveal-option', key, message: `Reveal option "${key}" must be a boolean.` })
      }
      continue
    }

    if (key === 'transition') {
      if (isRevealTransition(value)) {
        options.transition = value
      } else {
        diagnostics.push({ code: 'invalid-reveal-option', key, message: 'Reveal transition value is unsupported.' })
      }
      continue
    }

    diagnostics.push({ code: 'unsupported-reveal-option', key, message: `Reveal option "${key}" is not allowlisted.` })
  }

  return { options, diagnostics }
}

export function buildRevealConfig(input: {
  generatedOptions?: GeneratedRevealOptions
  plugins: unknown[]
  onDiagnostics?: (diagnostics: RevealConfigDiagnostic[]) => void
}): SafeRevealConfig {
  const { options, diagnostics } = normalizeGeneratedRevealOptions(input.generatedOptions)
  const parsedGenerated = safeRevealOptionsSchema.safeParse(options)
  const generated = parsedGenerated.success ? parsedGenerated.data : {}

  if (diagnostics.length > 0) input.onDiagnostics?.(diagnostics)

  return {
    ...generated,
    plugins: input.plugins,
    ...appOwnedRevealOptions,
  }
}
