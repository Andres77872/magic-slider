import { describe, expect, it } from 'vitest'

import { validatePresentation } from '../domain/presentationSchema'
import { buildSafeSlideDom } from './safeSlideRenderer'
import { isSafeImageUrl } from './imageUrl'

describe('image URL boundary', () => {
  it.each(['https://v3.fal.media/files/example/image.webp', 'http://localhost:7000/image.png', '/templates/image.png'])('accepts an explicit web image or same-origin path: %s', (url) => {
    expect(isSafeImageUrl(url)).toBe(true)
    expect(validatePresentation({ slides: [{ backgroundImage: url }] }).ok).toBe(true)
    expect(buildSafeSlideDom({ slides: [{ backgroundImage: url }] }).diagnostics).toEqual([])
  })

  it.each(['//remote.test/a.png', '/\\remote.test/a.png', 'javascript:alert(1)', 'data:image/svg+xml,<svg/>', 'file:///etc/passwd', 'https://user:password@example.test/x', 'https://example.test/\nimage.png', ' https://example.test/image.png'])('rejects unsafe or ambiguous URLs consistently: %s', (url) => {
    expect(isSafeImageUrl(url)).toBe(false)
    expect(validatePresentation({ slides: [{ backgroundImage: url }] }).ok).toBe(false)
    const rendered = buildSafeSlideDom({ slides: [{ backgroundImage: url }] })
    expect(rendered.element.querySelector('section')).not.toHaveAttribute('data-background-image')
    expect(rendered.diagnostics).toEqual([expect.objectContaining({ code: 'unsafe-background-url' })])
  })
})
