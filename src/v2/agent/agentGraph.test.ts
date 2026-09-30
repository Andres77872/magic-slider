import { describe, expect, it } from 'vitest'

import committed from '../../../agent/magic-slider-v2.graph.json'
import { buildAgentGraph, authorPrompt } from './agentGraph'
import { CREATE_TOOL, EDIT_TOOL, catalogText, presentationTools } from './contract'
import { primitiveTypes } from '../catalog/registry'
import { iconNames } from '../catalog/icons'
import { themePresetNames } from '../render/theme'

type Node = { id: string; type: string; data: Record<string, unknown> }
type Edge = { source: string; target: string; sourceHandle: string; targetHandle: string }
type Graph = { nodes: Node[]; edges: Edge[]; timeout: number }

function inner(graph: Graph): Graph {
  return (graph.nodes.find((node) => node.type === 'inner')!.data.magic_flow as Graph)
}

describe('v2 agent graph', () => {
  it('matches the committed agent JSON (run `pnpm agent:v2` after catalog changes)', () => {
    expect(committed).toEqual(JSON.parse(JSON.stringify(buildAgentGraph())))
  })

  it('embeds the full primitive catalog, icon list and themes in the author prompt', () => {
    const prompt = authorPrompt()
    expect(prompt).toContain(catalogText())
    for (const type of primitiveTypes) expect(prompt).toContain(`- ${type}: `)
    for (const icon of iconNames) expect(prompt).toContain(icon)
    for (const theme of themePresetNames) expect(prompt).toContain(theme)
  })

  it('wires schema-only presentation tools only to the streaming author, and server tools to private stages', () => {
    const graph = inner(buildAgentGraph() as unknown as Graph)
    const byId = new Map(graph.nodes.map((node) => [node.id, node]))
    const toolEdges = graph.edges.filter((edge) => edge.targetHandle.startsWith('handle-tool-definition-'))
    const author = toolEdges.filter((edge) => edge.target === 'author').map((edge) => byId.get(edge.source)!)
    expect(author.map((node) => node.type)).toEqual(['node_tool', 'node_tool'])
    expect(author.map((node) => (node.data.tool as { function: { name: string } }).function.name)).toEqual([CREATE_TOOL, EDIT_TOOL])
    for (const stage of ['research', 'visuals']) {
      expect(toolEdges.filter((edge) => edge.target === stage).every((edge) => byId.get(edge.source)!.type === 'fetch')).toBe(true)
    }
    expect(byId.get('author')!.data).toMatchObject({ stream: true })
    expect(byId.get('author')!.data).not.toHaveProperty('json_output')
    // Only the author reaches END, so research and visuals never stream to the public client.
    expect(graph.edges.filter((edge) => byId.get(edge.target)!.type === 'end').map((edge) => edge.source)).toEqual(['author', 'author'])
    expect(graph.timeout).toBeGreaterThan(300)
    for (const edge of graph.edges) {
      expect(byId.has(edge.source) && byId.has(edge.target)).toBe(true)
      expect(edge.sourceHandle && edge.targetHandle).toBeTruthy()
    }
  })

  it('keeps provider credentials as environment placeholders', () => {
    const text = JSON.stringify(committed)
    expect(text).toContain('{{env.OPENAI_API_KEY}}')
    expect(text).toContain('{{ env.TAVILY_API_KEY }}')
    expect(text).toContain('{{ env.FAL_AI_API_KEY }}')
    expect(text).not.toMatch(/sk-[A-Za-z0-9]{12,}|tvly-[A-Za-z0-9]{8,}/)
  })

  it('exposes tool schemas that accept the client-side operation names', () => {
    const [create, edit] = presentationTools()
    expect(create.function.parameters).toMatchObject({ required: ['slides'] })
    const variants = ((edit.function.parameters.properties as Record<string, { items: { oneOf: Array<{ properties: { op: { const: string } } }> } }>).operations.items.oneOf)
    expect(variants.map((variant) => variant.properties.op.const)).toContain('update_block')
  })
})
