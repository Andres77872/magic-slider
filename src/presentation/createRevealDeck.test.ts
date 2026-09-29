import { afterEach, describe, expect, it, vi } from 'vitest'
import type { RevealApi, RevealPluginFactory } from 'reveal.js'
import type { HighlightPlugin } from 'reveal.js/plugin/highlight'
import type { NotesPlugin } from 'reveal.js/plugin/notes'

import { createRevealDeck } from './createRevealDeck'
import { buildRevealConfig } from './revealConfig'
import { RevealUrlConfigError } from './revealUrlBoundary'
import { resolveRevealPlugins, type DeferredRevealPlugin } from './pluginRegistry'

function createDeferredPlugin() {
  let resolve!: (factory: RevealPluginFactory) => void
  let reject!: (cause: unknown) => void
  const promise = new Promise<RevealPluginFactory>((onResolve, onReject) => {
    resolve = onResolve
    reject = onReject
  })
  const plugin: DeferredRevealPlugin = { kind: 'deferred-reveal-plugin', id: 'notes', load: vi.fn(() => promise) }
  return { plugin, resolve, reject }
}

describe('createRevealDeck integration', () => {
  afterEach(() => {
    window.history.replaceState(null, '', '/')
    document.body.replaceChildren()
    vi.unstubAllGlobals()
  })

  function createElement() {
    const element = document.createElement('div')
    element.className = 'reveal'
    const slides = document.createElement('div')
    slides.className = 'slides'
    const section = document.createElement('section')
    section.textContent = 'Example slide'
    slides.appendChild(section)
    element.appendChild(slides)
    document.body.appendChild(element)
    return element
  }

  it.each(['?embedded=false', '?postMessage=true', '?history=true', '?plugins=notes', '?print-pdf'])('blocks %s before Reveal modifies the page', (search) => {
    window.history.replaceState(null, '', search)
    const element = createElement()
    const initialMarkup = document.body.innerHTML
    const deck = createRevealDeck(element, buildRevealConfig({ plugins: [] }))

    expect(() => deck.initialize()).toThrow(RevealUrlConfigError)
    expect(document.body.innerHTML).toBe(initialMarkup)
    expect(document.documentElement).not.toHaveClass('reveal-full-page')
    expect(document.body).not.toHaveClass('reveal-viewport')
    expect(window.location.search).toBe(search)
    deck.destroy()
  })

  it('initializes the real embedded Reveal runtime with ordinary query parameters', async () => {
    window.history.replaceState(null, '', '?utm_source=test&embedded=true&hash=false')
    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false, addListener: vi.fn(), removeListener: vi.fn() })))
    const element = createElement()
    const deck = createRevealDeck(element, buildRevealConfig({ plugins: [] }))

    try {
      await deck.initialize()
      expect(element).toHaveClass('ready', 'reveal-viewport')
      expect(element.querySelector('section')).toHaveClass('present')
      expect(document.body).not.toHaveClass('reveal-viewport')
    } finally {
      deck.destroy()
    }
  })

  it('does not initialize plugins or Reveal after destruction during a download', async () => {
    const deferred = createDeferredPlugin()
    const factory = vi.fn(() => ({ id: 'notes', init: vi.fn() }))
    const element = createElement()
    const initialMarkup = element.outerHTML
    const deck = createRevealDeck(element, buildRevealConfig({ plugins: [deferred.plugin] }))
    const initialization = deck.initialize()
    deck.destroy()
    deferred.resolve(factory)

    await expect(initialization).rejects.toMatchObject({ name: 'AbortError' })
    expect(factory).not.toHaveBeenCalled()
    expect(element.outerHTML).toBe(initialMarkup)
  })

  it('rejects failed plugin downloads before changing the page', async () => {
    const deferred = createDeferredPlugin()
    const element = createElement()
    const deck = createRevealDeck(element, buildRevealConfig({ plugins: [deferred.plugin] }))
    const initialization = deck.initialize()
    const cause = new Error('Network failed while downloading a plugin')
    deferred.reject(cause)

    await expect(initialization).rejects.toBe(cause)
    expect(element).not.toHaveClass('ready', 'reveal-viewport')
    deck.destroy()
  })

  it('checks URL conflicts before downloads and again before plugin initialization', async () => {
    const deferred = createDeferredPlugin()
    const factory = vi.fn(() => ({ id: 'notes', init: vi.fn() }))
    const element = createElement()
    const deck = createRevealDeck(element, buildRevealConfig({ plugins: [deferred.plugin] }))
    window.history.replaceState(null, '', '?embedded=false')

    expect(() => deck.initialize()).toThrow(RevealUrlConfigError)
    expect(deferred.plugin.load).not.toHaveBeenCalled()
    window.history.replaceState(null, '', '/')
    const initialization = deck.initialize()
    window.history.replaceState(null, '', '?postMessage=true')
    deferred.resolve(factory)

    await expect(initialization).rejects.toThrow(RevealUrlConfigError)
    expect(factory).not.toHaveBeenCalled()
    expect(element).not.toHaveClass('ready', 'reveal-viewport')
    deck.destroy()
  })

  it('preserves the complete Highlight language registry, code features, and Notes API', async () => {
    const element = createElement()
    const pre = document.createElement('pre')
    const code = document.createElement('code')
    code.className = 'language-javascript'
    code.setAttribute('data-line-numbers', '1|2')
    code.textContent = 'const answer = 42;\nconsole.log(answer);'
    pre.appendChild(code)
    element.querySelector('section')?.appendChild(pre)
    const { plugins } = resolveRevealPlugins(['highlight', 'notes'])
    const deck = createRevealDeck(element, buildRevealConfig({ plugins })) as RevealApi

    try {
      await deck.initialize()
      const highlight = deck.getPlugin('highlight') as HighlightPlugin
      const notes = deck.getPlugin('notes') as NotesPlugin
      const languages = highlight.hljs.listLanguages()

      expect(languages.length).toBeGreaterThan(180)
      expect(languages).toEqual(expect.arrayContaining(['javascript', 'typescript', 'python', 'sql', 'cpp', 'rust']))
      expect(code).toHaveClass('hljs')
      expect(code.querySelector('.hljs-keyword')).toHaveTextContent('const')
      expect(code.querySelector('.hljs-ln')).not.toBeNull()
      expect(pre.querySelector('code.fragment')).not.toBeNull()
      expect(typeof highlight.highlightBlock).toBe('function')
      expect(typeof notes.open).toBe('function')
      expect(element).toHaveClass('ready')
    } finally {
      deck.destroy()
    }
  })
})
