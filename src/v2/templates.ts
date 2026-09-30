/**
 * Starter decks authored with v2 primitives. They double as fixtures: tests
 * render every template, and the local replay server streams them back.
 * No external images are required, so they render offline.
 */

export interface DeckTemplate {
  id: string
  title: string
  description: string
  deck: Record<string, unknown>
}

const showcase = {
  version: 2,
  title: 'Magic Slider v2 — primitives tour',
  language: 'en',
  theme: { preset: 'aurora', fonts: { heading: 'grotesk', body: 'inter' }, radius: 'lg' },
  settings: { transition: 'slide', controls: true, progress: true, slideNumber: true },
  slides: [
    {
      id: 'cover',
      name: 'Cover',
      align: 'center',
      background: { gradient: 'aurora', pattern: 'mesh' },
      blocks: [
        { type: 'text', variant: 'eyebrow', text: 'Magic Slider v2', align: 'center' },
        { type: 'heading', level: 1, size: 'display', text: 'Presentations as ==composable primitives==', align: 'center', maxWidth: 'lg' },
        { type: 'text', variant: 'lead', text: 'Every slide is JSON the agent writes and the renderer draws — safely, beautifully and editable by id.', align: 'center', maxWidth: 'md' },
        {
          type: 'stack', direction: 'horizontal', gap: 'sm', justify: 'center', align: 'center',
          children: [
            { type: 'badge', text: '22 primitives', icon: 'layers' },
            { type: 'badge', text: '12 themes', icon: 'sparkles', tone: 'accent2' },
            { type: 'badge', text: 'Id-based edits', icon: 'wrench', tone: 'success' },
          ],
        },
      ],
      notes: 'Welcome. This deck is built only from v2 primitives, the same vocabulary the agent uses.',
    },
    {
      id: 'why',
      name: 'Why primitives',
      blocks: [
        { type: 'text', variant: 'eyebrow', text: '01 / Principle' },
        { type: 'heading', text: 'Small building blocks give the agent ==unlimited layouts==' },
        {
          type: 'grid', columns: 3, gap: 'lg',
          children: [
            { type: 'box', accentBar: 'top', children: [{ type: 'icon', name: 'puzzle', variant: 'circle' }, { type: 'heading', level: 3, text: 'Composable' }, { type: 'text', tone: 'muted', size: 'sm', text: 'Stacks, grids and boxes nest any primitive, so layouts are designed, not picked.' }] },
            { type: 'box', accentBar: 'top', variant: 'soft', children: [{ type: 'icon', name: 'shield-check', variant: 'circle', tone: 'success' }, { type: 'heading', level: 3, text: 'Safe by design' }, { type: 'text', tone: 'muted', size: 'sm', text: 'Declarative data only: no HTML, no scripts, allow-listed URLs and tokens.' }] },
            { type: 'box', accentBar: 'top', children: [{ type: 'icon', name: 'target', variant: 'circle', tone: 'accent2' }, { type: 'heading', level: 3, text: 'Precise edits' }, { type: 'text', tone: 'muted', size: 'sm', text: 'Every slide and block has an id, so follow-up requests change exactly what you ask.' }] },
          ],
        },
      ],
      notes: 'The catalog is the contract between the agent and the renderer.',
    },
    {
      id: 'kpis',
      name: 'KPI row',
      blocks: [
        { type: 'text', variant: 'eyebrow', text: '02 / Data' },
        { type: 'heading', text: 'Numbers become ==stat tiles==, not bullet points' },
        {
          type: 'grid', columns: 4, gap: 'md',
          children: [
            { type: 'box', children: [{ type: 'stat', value: '48%', label: 'Faster to first draft', delta: '+12 pts', trend: 'up', size: 'lg' }] },
            { type: 'box', children: [{ type: 'stat', value: '3.1×', label: 'More visual slides', icon: 'chart-bar', size: 'lg' }] },
            { type: 'box', children: [{ type: 'stat', value: '0', label: 'Raw HTML accepted', tone: 'success', size: 'lg' }] },
            { type: 'box', variant: 'accent', children: [{ type: 'stat', value: '100%', label: 'Editable by id', size: 'lg' }] },
          ],
        },
        { type: 'text', variant: 'caption', tone: 'muted', text: 'Illustrative figures for this tour.' },
      ],
    },
    {
      id: 'chart',
      name: 'Chart + insight',
      blocks: [
        { type: 'text', variant: 'eyebrow', text: '03 / Charts' },
        { type: 'heading', text: 'Charts render natively, ==themed and accessible==' },
        {
          type: 'grid', columns: '3fr 2fr', gap: 'xl', align: 'stretch',
          children: [
            { type: 'chart', kind: 'column', labels: ['2021', '2022', '2023', '2024', '2025'], series: [{ name: 'Decks generated (k)', values: [12, 19, 31, 47, 72] }], valueSuffix: 'k', highlight: 4, caption: 'Illustrative data' },
            {
              type: 'stack', gap: 'md', justify: 'center',
              children: [
                { type: 'stat', value: '6×', label: 'growth in four years', size: 'xl' },
                { type: 'callout', tone: 'accent', title: 'Insight', text: 'Highlight one bar to say what the chart **proves**.' },
              ],
            },
          ],
        },
      ],
    },
    {
      id: 'mix',
      name: 'Donut + line',
      blocks: [
        { type: 'heading', text: 'Eight chart kinds: parts, trends and rankings' },
        {
          type: 'grid', columns: 2, gap: 'xl', align: 'stretch',
          children: [
            { type: 'chart', kind: 'donut', labels: ['Charts', 'Diagrams', 'Text', 'Media'], series: [{ name: 'Share of blocks', values: [34, 26, 24, 16] }], valueSuffix: '%', highlight: 0, title: 'What decks are made of' },
            { type: 'chart', kind: 'line', labels: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun'], series: [{ name: 'Edits', values: [20, 28, 26, 40, 52, 61] }, { name: 'New decks', values: [14, 18, 22, 21, 30, 34] }], title: 'Monthly activity' },
          ],
        },
      ],
    },
    {
      id: 'section',
      name: 'Section break',
      align: 'center',
      tone: 'inverse',
      blocks: [
        { type: 'text', variant: 'eyebrow', text: 'Part two', align: 'center' },
        { type: 'heading', level: 1, text: 'Diagrams tell the ==how==', align: 'center' },
      ],
    },
    {
      id: 'flow',
      name: 'Process',
      blocks: [
        { type: 'heading', text: 'From prompt to presentation in ==four steps==' },
        {
          type: 'diagram', kind: 'flow', stagger: true,
          items: [
            { label: 'Brief', text: 'Topic, audience and goal', icon: 'message' },
            { label: 'Research', text: 'Sourced facts and datasets', icon: 'search' },
            { label: 'Design', text: 'Theme and imagery', icon: 'sparkles' },
            { label: 'Compose', text: 'Primitives, validated', icon: 'layers' },
          ],
        },
        { type: 'callout', tone: 'info', text: 'Each step runs as a stage of the runtime agent; only the composer talks to the browser.' },
      ],
    },
    {
      id: 'frameworks',
      name: 'Frameworks',
      blocks: [
        { type: 'heading', text: 'Cycles, pyramids and matrices without images' },
        {
          type: 'grid', columns: 2, gap: 'xl', align: 'stretch',
          children: [
            { type: 'diagram', kind: 'cycle', center: 'Feedback loop', items: [{ label: 'Generate', icon: 'sparkles' }, { label: 'Review', icon: 'eye' }, { label: 'Refine', icon: 'wrench' }, { label: 'Present', icon: 'megaphone' }] },
            { type: 'diagram', kind: 'pyramid', items: [{ label: 'Story', text: 'One message' }, { label: 'Evidence', text: 'Charts, stats' }, { label: 'Design', text: 'Theme, rhythm' }, { label: 'Safety', text: 'Validation' }] },
          ],
        },
      ],
    },
    {
      id: 'compare',
      name: 'Comparison',
      blocks: [
        { type: 'heading', text: 'v1 layouts vs ==v2 primitives==' },
        {
          type: 'table',
          columns: ['Capability', { header: 'v1', align: 'center' }, { header: 'v2', align: 'center' }],
          rows: [
            ['Fixed slide layouts', '✓', '✗'],
            ['Nested grids and cards', '✗', '✓'],
            ['Native charts and diagrams', '✗', '✓'],
            ['Edits by stable id', '✗', '✓'],
            ['Custom palettes and fonts', '✗', '✓'],
          ],
          highlightColumn: 2,
        },
      ],
    },
    {
      id: 'roadmap',
      name: 'Timeline',
      blocks: [
        { type: 'heading', text: 'Roadmaps read left to right' },
        {
          type: 'timeline', highlight: 1, stagger: true,
          items: [
            { label: 'v1', title: 'Layouts', text: 'Ten fixed slide layouts' },
            { label: 'v2', title: 'Primitives', text: 'Composable, themed blocks', icon: 'layers' },
            { label: 'Next', title: 'Collaboration', text: 'Shared decks and comments' },
          ],
        },
        {
          type: 'grid', columns: 3, gap: 'md',
          children: [
            { type: 'progress', value: 100, label: 'Renderer' },
            { type: 'progress', value: 85, label: 'Agent contract', tone: 'accent2' },
            { type: 'progress', value: 40, label: 'Collaboration', tone: 'warning' },
          ],
        },
      ],
    },
    {
      id: 'code',
      name: 'Code',
      blocks: [
        { type: 'heading', text: 'A block is just ==typed JSON==' },
        {
          type: 'grid', columns: '3fr 2fr', gap: 'lg', align: 'center',
          children: [
            { type: 'code', language: 'json', title: 'slide.json', lineNumbers: true, highlight: '1-3|4-6', source: '{\n  "type": "stat",\n  "value": "48%",\n  "label": "Faster to first draft",\n  "trend": "up"\n}' },
            { type: 'list', style: 'check', items: ['Validated per primitive', 'Repaired when almost right', 'Rendered to safe DOM'] },
          ],
        },
      ],
    },
    {
      id: 'quote',
      name: 'Quote',
      align: 'center',
      background: { gradient: 'spotlight' },
      blocks: [
        { type: 'quote', variant: 'large', align: 'center', text: 'Simplicity is prerequisite for reliability.', attribution: 'Edsger W. Dijkstra', role: 'How do we tell truths that might hurt? (1975)' },
      ],
    },
    {
      id: 'close',
      name: 'Closing',
      align: 'center',
      tone: 'accent',
      blocks: [
        { type: 'heading', level: 1, text: 'Describe your next deck', align: 'center' },
        { type: 'text', variant: 'lead', align: 'center', text: 'Then refine it slide by slide, block by block.' },
        { type: 'stack', direction: 'horizontal', justify: 'center', gap: 'sm', children: [{ type: 'badge', text: 'Present', icon: 'megaphone', variant: 'solid', tone: 'default' }, { type: 'badge', text: 'Export HTML', icon: 'package', variant: 'outline', tone: 'default' }] },
      ],
    },
  ],
}

const pitch = {
  version: 2,
  title: 'Pitch template',
  theme: { preset: 'slate', fonts: { heading: 'modern', body: 'inter' } },
  settings: { transition: 'fade', slideNumber: true },
  slides: [
    { id: 'cover', align: 'center', background: { gradient: 'spotlight' }, blocks: [{ type: 'text', variant: 'eyebrow', text: 'Seed round · 2026', align: 'center' }, { type: 'heading', level: 1, text: 'Your company, ==one line==', align: 'center' }, { type: 'text', variant: 'lead', text: 'What you do, for whom, and why now.', align: 'center' }] },
    { id: 'problem', blocks: [{ type: 'text', variant: 'eyebrow', text: 'Problem' }, { type: 'heading', text: 'State the pain as a ==measurable cost==' }, { type: 'list', style: 'cross', items: ['Who suffers and how often', 'What it costs today', 'Why current fixes fail'] }] },
    { id: 'solution', blocks: [{ type: 'text', variant: 'eyebrow', text: 'Solution' }, { type: 'heading', text: 'How the product removes the pain' }, { type: 'diagram', kind: 'flow', items: [{ label: 'Input', icon: 'click' }, { label: 'Magic', icon: 'sparkles' }, { label: 'Outcome', icon: 'trophy' }] }] },
    { id: 'market', blocks: [{ type: 'heading', text: 'A market worth ==winning==' }, { type: 'diagram', kind: 'funnel', items: [{ label: 'TAM', text: 'Everyone with the problem' }, { label: 'SAM', text: 'Reachable segment' }, { label: 'SOM', text: 'Three-year goal' }] }] },
    { id: 'traction', blocks: [{ type: 'heading', text: 'Traction that compounds' }, { type: 'grid', columns: 3, children: [{ type: 'box', children: [{ type: 'stat', value: '—', label: 'Customers' }] }, { type: 'box', children: [{ type: 'stat', value: '—', label: 'Monthly growth' }] }, { type: 'box', children: [{ type: 'stat', value: '—', label: 'Net retention' }] }] }] },
    { id: 'ask', align: 'center', tone: 'inverse', blocks: [{ type: 'text', variant: 'eyebrow', text: 'The ask', align: 'center' }, { type: 'heading', level: 1, text: 'Raise ==$X== to reach the next milestone', align: 'center' }] },
  ],
}

export const deckTemplates: DeckTemplate[] = [
  { id: 'showcase', title: 'Primitives tour', description: 'Every layout, chart and diagram in one deck', deck: showcase },
  { id: 'pitch', title: 'Pitch skeleton', description: 'Problem → solution → market → ask', deck: pitch },
]
