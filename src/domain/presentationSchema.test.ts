import { describe, expect, it } from 'vitest'

import { validatePresentation } from './presentationSchema'

const validDeck = {
  slides: [{ title: 'Intro', content: 'Plain safe text' }],
  plugins: ['highlight', 'notes'],
  revealOptions: { controls: true, progress: true, transition: 'slide' },
}

describe('validatePresentation', () => {
  it('accepts a valid transitional presentation deck', () => {
    expect(validatePresentation(validDeck)).toMatchObject({ ok: true, data: validDeck })
  })

  it('rejects missing and empty slides', () => {
    expect(validatePresentation({})).toMatchObject({ ok: false })
    expect(validatePresentation({ slides: [] })).toMatchObject({ ok: false })
  })

  it('enforces slide-count and string-length limits', () => {
    expect(
      validatePresentation({ slides: Array.from({ length: 51 }, (_, index) => ({ title: `${index}` })) }),
    ).toMatchObject({ ok: false })
    expect(validatePresentation({ slides: [{ title: 'x'.repeat(501) }] })).toMatchObject({ ok: false })
  })

  it('rejects unknown Reveal plugins', () => {
    expect(validatePresentation({ ...validDeck, plugins: ['highlight', 'unknown-plugin'] })).toMatchObject({
      ok: false,
      error: expect.objectContaining({ category: 'plugin' }),
    })
  })

  it('rejects unsafe Reveal options and generated app-invariant overrides', () => {
    expect(validatePresentation({ ...validDeck, revealOptions: { embedded: false } })).toMatchObject({
      ok: false,
    })
  })

  it('rejects unsafe attributes before rendering', () => {
    expect(
      validatePresentation({ slides: [{ title: 'Bad attrs', attributes: { onclick: 'alert(1)' } }] }),
    ).toMatchObject({ ok: false })
  })

  it('rejects unsafe background URLs', () => {
    expect(
      validatePresentation({ slides: [{ title: 'Bad URL', background: 'javascript:alert(1)' }] }),
    ).toMatchObject({ ok: false })
  })

  it('rejects unsafe legacy raw HTML content by default', () => {
    expect(
      validatePresentation({ slides: [{ title: 'Legacy', content: '<img src=x onerror=alert(1)>' }] }),
    ).toMatchObject({
      ok: false,
      error: expect.objectContaining({ category: 'unsafe-legacy-content' }),
    })
  })
})
