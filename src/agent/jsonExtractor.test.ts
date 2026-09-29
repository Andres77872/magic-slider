import { describe, expect, it } from 'vitest'

import { extractPresentationJson } from './jsonExtractor'

describe('extractPresentationJson', () => {
  it('rejects empty output as a JSON parse error', () => {
    expect(extractPresentationJson('', { maxBytes: 1_000 })).toMatchObject({
      ok: false,
      error: expect.objectContaining({ category: 'json-parse' }),
    })
  })

  it('extracts fenced JSON as unknown parsed data for later validation', () => {
    const result = extractPresentationJson('```json\n{"slides":[{"title":"Intro"}]}\n```', {
      maxBytes: 1_000,
    })

    expect(result).toMatchObject({ ok: true, data: { slides: [{ title: 'Intro' }] } })
  })

  it('rejects malformed JSON with a typed parse error', () => {
    expect(extractPresentationJson('{"slides": [}', { maxBytes: 1_000 })).toMatchObject({
      ok: false,
      error: expect.objectContaining({ category: 'json-parse' }),
    })
  })

  it('rejects truncated JSON with parse diagnostics', () => {
    expect(extractPresentationJson('{"slides":[{"title":"Intro"}', { maxBytes: 1_000 })).toMatchObject({
      ok: false,
      error: expect.objectContaining({ category: 'json-parse' }),
    })
  })

  it('rejects oversized output before parsing the payload', () => {
    expect(extractPresentationJson('{"slides":[]}', { maxBytes: 4 })).toMatchObject({
      ok: false,
      error: expect.objectContaining({ category: 'size-limit' }),
    })
  })
})
