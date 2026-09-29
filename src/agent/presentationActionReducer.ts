import { validatePresentation } from '../domain/presentationSchema'
import type { PresentationAction, SlidePatch } from '../domain/presentationActions'
import type { ValidatedPresentationConfig, ValidatedSlide } from '../domain/presentationTypes'
import { createAppError, type AppErrorDiagnostic, type GenerationError } from '../lib/errors'

export type ActionDiagnostic = AppErrorDiagnostic

export type ApplyPresentationActionResult =
  | { ok: true; deck: ValidatedPresentationConfig; diagnostics?: ActionDiagnostic[] }
  | { ok: false; deck: ValidatedPresentationConfig | null; error: GenerationError; diagnostics: ActionDiagnostic[] }

function actionError(
  deck: ValidatedPresentationConfig | null,
  code: string,
  message: string,
  details?: unknown,
): ApplyPresentationActionResult {
  const diagnostics = [{ code, message, details }]
  return {
    ok: false,
    deck,
    diagnostics,
    error: createAppError({ category: 'validation', diagnostics }) as GenerationError,
  }
}

function requireDeck(current: ValidatedPresentationConfig | null): current is ValidatedPresentationConfig {
  return Boolean(current)
}

function validateCandidate(
  previous: ValidatedPresentationConfig | null,
  candidate: unknown,
): ApplyPresentationActionResult {
  const validated = validatePresentation(candidate)
  if (validated.ok) return { ok: true, deck: validated.data }

  return {
    ok: false,
    deck: previous,
    error: validated.error,
    diagnostics: validated.error.diagnostics ?? [{ code: 'validation', message: validated.error.message }],
  }
}

function withoutActionName<Action extends { action: string }>(action: Action): Omit<Action, 'action'> {
  const rest: Partial<Action> = { ...action }
  delete rest.action
  return rest as Omit<Action, 'action'>
}

function applySlidePatch(slide: ValidatedSlide, patch: SlidePatch): ValidatedSlide {
  const next: Record<string, unknown> = { ...slide }
  for (const [key, value] of Object.entries(patch)) {
    if (value === null) delete next[key]
    else if (value !== undefined) next[key] = value
  }
  return next as ValidatedSlide
}

function checkIndex(deck: ValidatedPresentationConfig, index: number, label: string): ActionDiagnostic | null {
  if (index >= 0 && index < deck.slides.length) return null
  return { code: 'out-of-bounds', path: label, message: `${label} is outside the current slide range.` }
}

export function applyPresentationAction(
  current: unknown | null,
  action: PresentationAction,
): ApplyPresentationActionResult {
  const previous = current === null ? null : validatePresentation(current)
  const currentDeck = previous?.ok ? previous.data : null

  if (action.action === 'create_deck') {
    return validateCandidate(currentDeck, withoutActionName(action))
  }

  if (!requireDeck(currentDeck)) {
    return actionError(null, 'missing-deck', `${action.action} requires an existing deck.`)
  }

  if (action.action === 'add_slide') {
    const insertIndex = action.afterIndex === undefined ? currentDeck.slides.length : action.afterIndex + 1
    if (insertIndex < 0 || insertIndex > currentDeck.slides.length) {
      return actionError(currentDeck, 'out-of-bounds', 'afterIndex is outside the current slide range.', { afterIndex: action.afterIndex })
    }

    const slides = [...currentDeck.slides]
    slides.splice(insertIndex, 0, action.slide)
    return validateCandidate(currentDeck, { ...currentDeck, slides })
  }

  if (action.action === 'edit_slide') {
    const diagnostic = checkIndex(currentDeck, action.slideIndex, 'slideIndex')
    if (diagnostic) return actionError(currentDeck, diagnostic.code ?? 'out-of-bounds', diagnostic.message, { slideIndex: action.slideIndex })

    const slides = currentDeck.slides.map((slide, index) => (
      index === action.slideIndex ? applySlidePatch(slide, action.patch) : slide
    ))
    return validateCandidate(currentDeck, { ...currentDeck, slides })
  }

  if (action.action === 'update_deck') {
    const { revealOptions, ...settings } = withoutActionName(action)
    return validateCandidate(currentDeck, {
      ...currentDeck,
      ...settings,
      ...(revealOptions ? { revealOptions: { ...currentDeck.revealOptions, ...revealOptions } } : {}),
    })
  }

  if (action.action === 'delete_slide') {
    const diagnostic = checkIndex(currentDeck, action.slideIndex, 'slideIndex')
    if (diagnostic) return actionError(currentDeck, diagnostic.code ?? 'out-of-bounds', diagnostic.message, { slideIndex: action.slideIndex })
    if (currentDeck.slides.length === 1) return actionError(currentDeck, 'final-slide-delete', 'Cannot delete the final remaining slide.')

    return validateCandidate(currentDeck, {
      ...currentDeck,
      slides: currentDeck.slides.filter((_, index) => index !== action.slideIndex),
    })
  }

  const fromDiagnostic = checkIndex(currentDeck, action.fromIndex, 'fromIndex')
  if (fromDiagnostic) return actionError(currentDeck, fromDiagnostic.code ?? 'out-of-bounds', fromDiagnostic.message, { fromIndex: action.fromIndex })
  const toDiagnostic = checkIndex(currentDeck, action.toIndex, 'toIndex')
  if (toDiagnostic) return actionError(currentDeck, toDiagnostic.code ?? 'out-of-bounds', toDiagnostic.message, { toIndex: action.toIndex })

  if (action.fromIndex === action.toIndex) return validateCandidate(currentDeck, currentDeck)

  const slides = [...currentDeck.slides]
  const [moved] = slides.splice(action.fromIndex, 1)
  if (!moved) return actionError(currentDeck, 'out-of-bounds', 'fromIndex did not resolve to a slide.')
  slides.splice(action.toIndex, 0, moved)
  return validateCandidate(currentDeck, { ...currentDeck, slides })
}
