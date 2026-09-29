import { describe, expect, it } from 'vitest'

import { buildSafeSlideDom } from './safeSlideRenderer'

describe('buildSafeSlideDom', () => {
  it('renders generated title and content markup as text, not executable DOM', () => {
    const { element } = buildSafeSlideDom({
      slides: [{ title: '<img src=x onerror=alert(1)>', content: '<strong>not html</strong>' }],
    })

    expect(element.querySelector('img')).toBeNull()
    expect(element.querySelector('strong')).toBeNull()
    expect(element.textContent).toContain('<img src=x onerror=alert(1)>')
    expect(element.textContent).toContain('<strong>not html</strong>')
  })

  it('does not use generated content as innerHTML in the default path', () => {
    const { element } = buildSafeSlideDom({ slides: [{ title: 'Safe', content: '<em>literal</em>' }] })

    expect(element.innerHTML).not.toContain('<em>literal</em>')
    expect(element.textContent).toContain('<em>literal</em>')
  })

  it('applies only allowlisted attributes and backgrounds', () => {
    const { element, diagnostics } = buildSafeSlideDom({
      slides: [
        {
          title: 'Attrs',
          attributes: { 'data-auto-animate': 'true', onclick: 'alert(1)' },
          background: 'https://example.test/background.png',
        },
      ],
    })

    const section = element.querySelector('section')
    expect(section).toHaveAttribute('data-auto-animate', 'true')
    expect(section).not.toHaveAttribute('onclick')
    expect(section).toHaveAttribute('data-background-image', 'https://example.test/background.png')
    expect(diagnostics).toEqual([expect.objectContaining({ code: 'unsafe-attribute' })])
  })

  it('falls back safely for unsafe generated background URLs', () => {
    const { element, diagnostics } = buildSafeSlideDom({
      slides: [{ title: 'Unsafe URL', background: 'javascript:alert(1)' }],
    })

    expect(element.querySelector('section')).not.toHaveAttribute('data-background-image')
    expect(diagnostics).toEqual([expect.objectContaining({ code: 'unsafe-background-url' })])
  })

  it('renders speaker notes as Reveal-compatible safe text notes markup', () => {
    const { element } = buildSafeSlideDom({
      slides: [{ title: 'Notes', content: 'Visible', notes: '<script>alert(1)</script>' }],
    })

    const notes = element.querySelector('aside.notes')
    expect(notes).not.toBeNull()
    expect(notes?.textContent).toBe('<script>alert(1)</script>')
    expect(notes?.querySelector('script')).toBeNull()
    expect(element.querySelector('section')?.textContent).toContain('Visible')
  })

  it('uses backgroundImage as the explicit Reveal image source when both URL aliases are present', () => {
    const { element, diagnostics } = buildSafeSlideDom({
      slides: [
        {
          title: 'Background alias',
          background: 'https://example.test/legacy.png',
          backgroundImage: 'https://example.test/current.png',
        },
      ],
    })

    expect(element.querySelector('section')).toHaveAttribute('data-background-image', 'https://example.test/current.png')
    expect(diagnostics).toEqual([expect.objectContaining({ code: 'background-image-alias-collision' })])
  })

  it('groups visible text in a contrast panel for image-backed slides and keeps notes outside it', () => {
    const { element } = buildSafeSlideDom({ slides: [{ title: 'Image title', content: 'Readable body', notes: 'Presenter notes', backgroundImage: 'https://v3.fal.media/image.webp' }] })
    const section = element.querySelector('section')
    expect(section).toHaveClass('slide--image-background')
    expect(section?.querySelector('.slide-body h2')).toHaveTextContent('Image title')
    expect(section?.querySelector('.slide-body .slide-content')).toHaveTextContent('Readable body')
    expect(section?.querySelector('.slide-body .notes')).toBeNull()
    expect(section?.querySelector(':scope > .notes')).toHaveTextContent('Presenter notes')
  })

  it('rejects legacy raw HTML in the default rendering path', () => {
    expect(() =>
      buildSafeSlideDom({ slides: [{ title: 'Legacy', content: '<iframe src="x"></iframe>' }] }),
    ).toThrow(/unsafe legacy content|raw html/i)
  })
})
