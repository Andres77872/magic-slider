import { afterEach, describe, expect, it, vi } from 'vitest'

import { loadRevealPlugins, resolveRevealPlugins, type DeferredRevealPlugin } from './pluginRegistry'

describe('resolveRevealPlugins', () => {
  afterEach(() => vi.restoreAllMocks())

  it('resolves known highlight and notes plugins', () => {
    const result = resolveRevealPlugins(['highlight', 'notes', 'highlight'])

    expect(result.plugins).toHaveLength(2)
    expect(result.plugins.map((plugin) => plugin.id)).toEqual(['highlight', 'notes'])
    expect(result.diagnostics).toEqual([])
  })

  it('reports unknown-plugin diagnostics instead of silently filtering them', () => {
    const result = resolveRevealPlugins(['highlight', 'missing-plugin'])

    expect(result.plugins).toHaveLength(1)
    expect(result.diagnostics).toEqual([
      expect.objectContaining({ category: 'plugin', code: 'unknown-plugin', pluginName: 'missing-plugin' }),
    ])
  })

  it('loads only requested descriptors while preserving injected plugin objects', async () => {
    const factory = vi.fn(() => ({ id: 'notes' }))
    const [highlight, notes] = resolveRevealPlugins(['highlight', 'notes']).plugins
    const loadHighlight = vi.spyOn(highlight, 'load').mockResolvedValue(factory)
    const loadNotes = vi.spyOn(notes, 'load').mockResolvedValue(factory)
    const injected = { id: 'app-plugin', init: vi.fn() }
    const requested = resolveRevealPlugins(['notes', 'notes']).plugins

    expect(await loadRevealPlugins([...requested, injected])).toEqual([factory, injected])
    expect(loadNotes).toHaveBeenCalledTimes(1)
    expect(loadHighlight).not.toHaveBeenCalled()
    expect(factory).not.toHaveBeenCalled()
  })

  it('propagates plugin download failures to the initialization lifecycle', async () => {
    const cause = new Error('Plugin chunk unavailable')
    const failed: DeferredRevealPlugin = { kind: 'deferred-reveal-plugin', id: 'highlight', load: vi.fn().mockRejectedValue(cause) }

    await expect(loadRevealPlugins([failed])).rejects.toBe(cause)
  })
})
