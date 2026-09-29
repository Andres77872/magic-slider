import type { RevealPluginFactory } from 'reveal.js'

import type { AppErrorDiagnostic } from '../lib/errors'

export type SupportedRevealPluginName = 'highlight' | 'notes'

export interface DeferredRevealPlugin {
  kind: 'deferred-reveal-plugin'
  id: SupportedRevealPluginName
  load: () => Promise<RevealPluginFactory>
}

const revealPluginRegistry: Record<SupportedRevealPluginName, DeferredRevealPlugin> = {
  highlight: {
    kind: 'deferred-reveal-plugin',
    id: 'highlight',
    load: () => import('reveal.js/plugin/highlight').then((module) => module.default),
  },
  notes: {
    kind: 'deferred-reveal-plugin',
    id: 'notes',
    load: () => import('reveal.js/plugin/notes').then((module) => module.default),
  },
}

export interface PluginDiagnostic extends AppErrorDiagnostic {
  category: 'plugin'
  code: 'unknown-plugin'
  pluginName: string
}

export function resolveRevealPlugins(pluginNames: readonly string[] = []): {
  plugins: DeferredRevealPlugin[]
  diagnostics: PluginDiagnostic[]
} {
  const plugins: DeferredRevealPlugin[] = []
  const diagnostics: PluginDiagnostic[] = []

  for (const pluginName of new Set(pluginNames)) {
    if (pluginName === 'highlight' || pluginName === 'notes') {
      plugins.push(revealPluginRegistry[pluginName])
    } else {
      diagnostics.push({
        category: 'plugin',
        code: 'unknown-plugin',
        pluginName,
        message: `Unsupported Reveal plugin: ${pluginName}`,
      })
    }
  }

  return { plugins, diagnostics }
}

function isDeferredRevealPlugin(plugin: unknown): plugin is DeferredRevealPlugin {
  return typeof plugin === 'object' && plugin !== null
    && 'kind' in plugin && plugin.kind === 'deferred-reveal-plugin'
    && 'load' in plugin && typeof plugin.load === 'function'
}

export function loadRevealPlugins(plugins: readonly unknown[]): Promise<unknown[]> {
  return Promise.all(plugins.map((plugin) => isDeferredRevealPlugin(plugin) ? plugin.load() : plugin))
}
