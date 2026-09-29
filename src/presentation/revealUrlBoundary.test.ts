import { describe, expect, it } from 'vitest'

import { appOwnedRevealOptions } from './revealConfig'
import { assertSafeRevealUrl, RevealUrlConfigError } from './revealUrlBoundary'

describe('assertSafeRevealUrl', () => {
  it('accepts ordinary app parameters and matching editor settings', () => {
    expect(() => assertSafeRevealUrl({ utm: 'campaign', transition: 'fade', ...appOwnedRevealOptions }, '?utm=campaign')).not.toThrow()
    expect(() => assertSafeRevealUrl({}, '')).not.toThrow()
  })

  it.each(Object.keys(appOwnedRevealOptions))('rejects a conflicting %s setting', (key) => {
    expect(() => assertSafeRevealUrl({ [key]: 'conflicting-value' }, '')).toThrow(RevealUrlConfigError)
  })

  it.each(['notes', '', null, false, []])('rejects plugin registry replacement from the URL: %j', (plugins) => {
    expect(() => assertSafeRevealUrl({ plugins }, '')).toThrow(/plugins/)
  })

  it.each(['?print-pdf', '?view=print-pdf', '?PRINT-PDF'])('rejects Reveal’s legacy print activation: %s', (search) => {
    expect(() => assertSafeRevealUrl({}, search)).toThrow(/print-pdf/)
  })

  it('identifies conflicting parameter names without exposing their values', () => {
    expect(() => assertSafeRevealUrl({ embedded: false, plugins: 'untrusted-private-value' }, ''))
      .toThrow('This link changes settings managed by the editor. Remove these URL parameters and reload: embedded, plugins.')
  })
})
