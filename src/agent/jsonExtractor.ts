import { createAppError, type GenerationError } from '../lib/errors'

export type JsonExtractionResult = { ok: true; data: unknown } | { ok: false; error: GenerationError }

function stripJsonFence(input: string): string {
  const trimmed = input.trim()
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i)
  return (fenced?.[1] ?? trimmed).trim()
}

export function extractPresentationJson(input: string, options: { maxBytes: number }): JsonExtractionResult {
  if (new TextEncoder().encode(input).byteLength > options.maxBytes) {
    return { ok: false, error: createAppError({ category: 'size-limit' }) as GenerationError }
  }

  const jsonText = stripJsonFence(input)
  if (jsonText === '') {
    return { ok: false, error: createAppError({ category: 'json-parse' }) as GenerationError }
  }

  try {
    return { ok: true, data: JSON.parse(jsonText) as unknown }
  } catch (cause) {
    return {
      ok: false,
      error: createAppError({
        category: 'json-parse',
        diagnostics: [{ code: 'invalid-json', message: 'Agent output could not be parsed as JSON.' }],
        cause,
      }) as GenerationError,
    }
  }
}
