import { describe, expect, it, vi } from 'vitest'

import { exportPresentationHtml } from './exportPresentation'

describe('exportPresentationHtml', () => {
  it('bundles an independent viewer and preserves text, images, notes and options', () => {
    const html = exportPresentationHtml({
      slides: [{ title: 'Planning <2026>', content: 'First line\nSecond line', backgroundImage: '/images/plan.png', notes: 'Discuss costs <script>alert(1)</script>' }],
      revealOptions: { transition: 'fade', controls: true },
    }, 'https://slides.example.test/studio')
    const doc = new DOMParser().parseFromString(html, 'text/html')

    expect(html).toMatch(/^<!doctype html>/)
    expect(doc.title).toBe('Planning <2026>')
    expect(doc.querySelector('.slides > section')?.getAttribute('data-background-image')).toBe('https://slides.example.test/images/plan.png')
    expect(doc.querySelector('.slide-body')?.textContent).toContain('Planning <2026>')
    expect([...doc.querySelectorAll('.slide-content li')].map((item) => item.textContent)).toEqual(['First line', 'Second line'])
    expect(doc.querySelector('aside.notes')?.textContent).toBe('Discuss costs <script>alert(1)</script>')
    expect(doc.querySelector('aside.notes script')).toBeNull()
    expect(doc.querySelectorAll('script')).toHaveLength(1)
    expect(doc.querySelector('script')?.textContent).toContain('"transition":"fade"')
    expect(doc.querySelector('script')?.textContent).toContain('postMessage')
    expect(doc.querySelectorAll('script[src], link[rel="stylesheet"]')).toHaveLength(0)
    expect(doc.querySelector('.export-notes summary')?.textContent).toBe('Speaker notes')
  })

  it('escapes closing tags and excludes application credentials', () => {
    vi.stubEnv('VITE_AGENT_API_KEY', 'secret-never-export')
    try {
      const html = exportPresentationHtml({ slides: [{ title: '</title><script>bad()</script>', notes: '</script><img src=x onerror=bad()>' }] })
      const doc = new DOMParser().parseFromString(html, 'text/html')
      expect(doc.querySelectorAll('script')).toHaveLength(1)
      expect(doc.querySelector('img')).toBeNull()
      expect(doc.title).toBe('</title><script>bad()</script>')
      expect(html).not.toContain('secret-never-export')
      expect(html).not.toContain('VITE_AGENT_API_KEY')
    } finally {
      vi.unstubAllEnvs()
    }
  })

  it('revalidates untrusted export inputs before serializing attributes', () => {
    expect(() => exportPresentationHtml({ slides: [{ attributes: { onclick: 'bad()' } }] })).toThrow()
  })
})
