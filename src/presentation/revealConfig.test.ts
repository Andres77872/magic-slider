import { describe, expect, it, vi } from 'vitest'

import { buildRevealConfig, normalizeGeneratedRevealOptions } from './revealConfig'

describe('buildRevealConfig', () => {
  it('keeps allowlisted generated options', () => {
    expect(
      buildRevealConfig({
        generatedOptions: { controls: false, progress: false, transition: 'fade' },
        plugins: [],
      }),
    ).toMatchObject({ controls: false, progress: false, transition: 'fade' })
  })

  it('forces app-owned invariants after generated options are considered', () => {
    const onDiagnostics = vi.fn()

    expect(
      buildRevealConfig({
        generatedOptions: {
          embedded: false,
          keyboard: true,
          keyboardCondition: 'global',
          hash: true,
          respondToHashChanges: true,
          postMessage: true,
          postMessageEvents: true,
          history: true,
          scrollActivationWidth: 435,
          view: 'scroll',
        },
        plugins: [],
        onDiagnostics,
      }),
    ).toMatchObject({
      embedded: true,
      keyboardCondition: 'focused',
      hash: false,
      respondToHashChanges: false,
      postMessage: false,
      postMessageEvents: false,
      history: false,
      scrollActivationWidth: 0,
      view: null,
    })
    expect(onDiagnostics).toHaveBeenCalledWith(
      expect.arrayContaining([expect.objectContaining({ code: 'app-owned-reveal-option', key: 'keyboardCondition' })]),
    )
  })

  it('preserves valid generated options while diagnosing invalid siblings', () => {
    const { options, diagnostics } = normalizeGeneratedRevealOptions({
      controls: false,
      progress: true,
      center: 'yes',
      transition: 'zoom',
      unknownOption: true,
    })

    expect(options).toEqual({ controls: false, progress: true, transition: 'zoom' })
    expect(diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'invalid-reveal-option', key: 'center' }),
        expect.objectContaining({ code: 'unsupported-reveal-option', key: 'unknownOption' }),
      ]),
    )
  })
})
