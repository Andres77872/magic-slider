import { describe, expect, it } from 'vitest'

import { normalizeLegacyContent } from './legacyContentBoundary'

describe('normalizeLegacyContent', () => {
  it('normalizes text-only legacy content for the transitional cleanup path', () => {
    expect(normalizeLegacyContent('Plain text only')).toMatchObject({ ok: true, text: 'Plain text only' })
  })

  it.each([
    ['script tags', '<script>alert(1)</script>'],
    ['event handlers', '<img src="x" onerror="alert(1)">'],
    ['iframes', '<iframe src="https://evil.example"></iframe>'],
    ['unsafe styles', '<p style="background:url(javascript:alert(1))">x</p>'],
    ['unsafe URL schemes', '<a href="javascript:alert(1)">x</a>'],
    ['raw markup', '<strong>legacy html</strong>'],
  ])('rejects %s with unsafe legacy content diagnostics', (_label, content) => {
    expect(normalizeLegacyContent(content)).toMatchObject({
      ok: false,
      error: expect.objectContaining({ category: 'unsafe-legacy-content' }),
    })
  })
})
