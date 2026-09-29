import { z } from 'zod'

import { logger } from '../lib/logger'
import { deckSettingsShape, presentationConfigSchema, safeRevealOptionKeys, safeRevealOptionsSchema, slideSchema, type ValidatedSlide } from './presentationSchema'

export const presentationToolNameSchema = z.enum([
  'create_deck',
  'add_slide',
  'edit_slide',
  'delete_slide',
  'reorder_slides',
  'update_deck',
])

export type PresentationToolName = z.infer<typeof presentationToolNameSchema>

const createDeckActionSchema = z.strictObject({
  action: z.literal('create_deck'),
  slides: presentationConfigSchema.shape.slides,
  ...deckSettingsShape,
})

const addSlideActionSchema = z.strictObject({
  action: z.literal('add_slide'),
  afterIndex: z.number().int().min(-1).optional(),
  slide: slideSchema,
})

// A null patch value removes that optional field from the slide. The reducer
// validates the whole resulting deck, so field refinements still apply.
export type SlidePatch = { [Key in keyof ValidatedSlide]?: ValidatedSlide[Key] | null }
const slidePatchSchema = z.strictObject(
  Object.fromEntries(Object.entries(slideSchema.shape).map(([key, schema]) => [key, schema.nullable()])),
) as unknown as z.ZodType<SlidePatch>

const editSlideActionSchema = z.strictObject({
  action: z.literal('edit_slide'),
  slideIndex: z.number().int().min(0),
  patch: slidePatchSchema,
})

const deleteSlideActionSchema = z.strictObject({
  action: z.literal('delete_slide'),
  slideIndex: z.number().int().min(0),
})

const reorderSlidesActionSchema = z.strictObject({
  action: z.literal('reorder_slides'),
  fromIndex: z.number().int().min(0),
  toIndex: z.number().int().min(0),
})

const updateDeckActionSchema = z.strictObject({
  action: z.literal('update_deck'),
  ...deckSettingsShape,
})

export const presentationActionSchema = z.discriminatedUnion('action', [
  createDeckActionSchema,
  addSlideActionSchema,
  editSlideActionSchema,
  deleteSlideActionSchema,
  reorderSlidesActionSchema,
  updateDeckActionSchema,
])

export type PresentationAction = z.infer<typeof presentationActionSchema>
export type PresentationActionInput = z.input<typeof presentationActionSchema>
export type PresentationActionToolCall = {
  id?: string
  index?: number
  type?: string
  function?: {
    name?: string
    arguments?: string
  }
  execution?: 'client' | 'server' | string
  source?: 'schema_only' | 'callable' | string
}

export { safeRevealOptionsSchema }

const appOwnedRevealOptionKeys = new Set([
  'embedded',
  'hash',
  'keyboard',
  'keyboardCondition',
  'plugins',
  'postMessage',
  'respondToHashChanges',
])

function normalizeGeneratedRevealOptions(argumentsRecord: Record<string, unknown>): Record<string, unknown> {
  const revealOptions = argumentsRecord.revealOptions
  if (!revealOptions || typeof revealOptions !== 'object' || Array.isArray(revealOptions)) return argumentsRecord

  const normalizedRevealOptions = Object.fromEntries(
    Object.entries(revealOptions).filter(([key]) => safeRevealOptionKeys.has(key) && !appOwnedRevealOptionKeys.has(key)),
  )

  return { ...argumentsRecord, revealOptions: normalizedRevealOptions }
}

/**
 * Batch tool: every change of an edit request in one call. Some models emit a
 * single function call per response, so multi-part edits must fit in one call.
 */
export const APPLY_CHANGES_TOOL = 'apply_changes'
const batchableActions = new Set<PresentationToolName>(['add_slide', 'edit_slide', 'delete_slide', 'reorder_slides', 'update_deck'])
export const MAX_BATCH_CHANGES = 50

function readToolCall(toolCall: unknown): { name: string; args: Record<string, unknown> } {
  if (!toolCall || typeof toolCall !== 'object') {
    throw new Error('Presentation tool call must be an object.')
  }

  const candidate = toolCall as PresentationActionToolCall
  const functionName = candidate.function?.name
  if (!functionName) throw new Error('Presentation tool call is missing function.name.')

  const rawArguments = candidate.function?.arguments ?? '{}'
  let parsedArguments: unknown
  try {
    parsedArguments = JSON.parse(rawArguments)
  } catch (cause) {
    throw Object.assign(new Error(`Malformed presentation tool arguments for ${functionName}: ${String(cause)}`), { cause })
  }

  if (!parsedArguments || typeof parsedArguments !== 'object' || Array.isArray(parsedArguments)) {
    throw new Error(`Presentation tool arguments for ${functionName} must be an object.`)
  }
  return { name: functionName, args: parsedArguments as Record<string, unknown> }
}

const slideKeys = new Set(Object.keys(slideSchema.shape))

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

/**
 * Models occasionally break a multi-line string: the text after a newline
 * becomes a key with an empty value. Rejoin such prose to content, and drop
 * other unknown top-level slide fields (they would never render) so one
 * malformed field cannot discard a whole generated deck. Nested fields and
 * every safety check stay strict.
 */
export function repairGeneratedSlide(slide: unknown): unknown {
  if (!isRecord(slide)) return slide
  const repaired: Record<string, unknown> = {}
  const continuation: string[] = []
  const dropped: string[] = []
  for (const [key, value] of Object.entries(slide)) {
    if (slideKeys.has(key)) repaired[key] = value
    else if (value === '' && /\s/.test(key.trim()) && key.trim().length > 12) continuation.push(key.trim())
    else dropped.push(key)
  }
  if (continuation.length) {
    const base = typeof repaired.content === 'string' ? repaired.content : ''
    repaired.content = [base, ...continuation].filter(Boolean).join('\n')
  }
  if (continuation.length || dropped.length) {
    logger.warn('Repaired a malformed generated slide.', { rejoinedLines: continuation.length, droppedFields: dropped.map((key) => key.slice(0, 40)) })
  }
  return repaired
}

function repairActionArguments(args: Record<string, unknown>): Record<string, unknown> {
  const next = { ...args }
  if (Array.isArray(next.slides)) next.slides = next.slides.map(repairGeneratedSlide)
  if ('slide' in next) next.slide = repairGeneratedSlide(next.slide)
  if ('patch' in next) next.patch = repairGeneratedSlide(next.patch)
  return next
}

function parseActionArguments(functionName: string, args: Record<string, unknown>): PresentationAction {
  const parsedName = presentationToolNameSchema.safeParse(functionName)
  if (!parsedName.success) throw new Error(`Unsupported presentation tool: ${functionName}`)

  if ('action' in args && args.action !== parsedName.data) {
    throw new Error(`Presentation tool arguments cannot override function.name: ${functionName}`)
  }

  const action = presentationActionSchema.parse({
    ...normalizeGeneratedRevealOptions(repairActionArguments(args)),
    action: parsedName.data,
  })
  // Only new tool calls must change something; saved action logs may hold older no-op edits.
  if (action.action === 'edit_slide' && Object.keys(action.patch).length === 0) {
    throw new Error('A slide patch must change at least one field.')
  }
  if (action.action === 'update_deck' && Object.keys(action).length === 1) {
    throw new Error('update_deck must change at least one setting.')
  }
  return action
}

export function parsePresentationToolCall(toolCall: unknown): PresentationAction {
  const { name, args } = readToolCall(toolCall)
  return parseActionArguments(name, args)
}

/** Parses one tool call into the ordered actions it requests, expanding apply_changes batches. */
export function parsePresentationToolCalls(toolCall: unknown): PresentationAction[] {
  const { name, args } = readToolCall(toolCall)
  if (name !== APPLY_CHANGES_TOOL) return [parseActionArguments(name, args)]

  const { changes, ...unexpected } = args
  if (Object.keys(unexpected).length > 0) throw new Error(`Unsupported ${APPLY_CHANGES_TOOL} fields: ${Object.keys(unexpected).join(', ')}`)
  if (!Array.isArray(changes) || changes.length === 0 || changes.length > MAX_BATCH_CHANGES) {
    throw new Error(`${APPLY_CHANGES_TOOL} needs 1-${MAX_BATCH_CHANGES} changes.`)
  }
  return changes.map((change, index) => {
    if (!change || typeof change !== 'object' || Array.isArray(change)) throw new Error(`Change ${index} must be an object.`)
    const { action, ...changeArgs } = change as Record<string, unknown>
    if (typeof action !== 'string' || !batchableActions.has(action as PresentationToolName)) {
      throw new Error(`Change ${index} has an unsupported action: ${String(action)}`)
    }
    return parseActionArguments(action, changeArgs)
  })
}
