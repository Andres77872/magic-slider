import { PLACEHOLDER_IMAGE } from './editorCommands'

/**
 * Layouts offered by "New slide". Each builds a raw slide from primitives with
 * placeholder copy the user overwrites; ids are assigned when it is added.
 */
export interface SlideStarter {
  id: string
  label: string
  description: string
  /** Studio icon name (lucide). */
  icon: string
  build: () => Record<string, unknown>
}

export const slideStarters: SlideStarter[] = [
  {
    id: 'blank',
    label: 'Blank',
    description: 'An empty slide to compose freely',
    icon: 'square',
    build: () => ({ name: 'Blank', blocks: [] }),
  },
  {
    id: 'title',
    label: 'Title',
    description: 'Eyebrow, big title and a lead line',
    icon: 'heading-1',
    build: () => ({
      name: 'Title',
      align: 'center',
      blocks: [
        { type: 'text', variant: 'eyebrow', text: 'Eyebrow', align: 'center', tone: 'accent' },
        { type: 'heading', level: 1, text: 'A title that states the ==big idea==', align: 'center', maxWidth: 'lg' },
        { type: 'text', variant: 'lead', text: 'One line that frames what the audience will get.', align: 'center', tone: 'muted', maxWidth: 'md' },
      ],
    }),
  },
  {
    id: 'section',
    label: 'Section break',
    description: 'Inverse slide that opens a new part',
    icon: 'bookmark',
    build: () => ({
      name: 'Section',
      align: 'center',
      tone: 'inverse',
      blocks: [
        { type: 'text', variant: 'eyebrow', text: 'Part 02', align: 'center' },
        { type: 'heading', level: 1, text: 'Section title', align: 'center' },
      ],
    }),
  },
  {
    id: 'content',
    label: 'Title and bullets',
    description: 'A takeaway title with a short list',
    icon: 'list',
    build: () => ({
      name: 'Key points',
      blocks: [
        { type: 'text', variant: 'eyebrow', text: 'Topic' },
        { type: 'heading', text: 'A takeaway title, written as a full claim' },
        { type: 'list', style: 'check', items: ['First supporting point', 'Second supporting point', 'Third supporting point'] },
      ],
    }),
  },
  {
    id: 'split',
    label: 'Text and image',
    description: 'Two columns: story beside a picture',
    icon: 'columns-2',
    build: () => ({
      name: 'Text and image',
      blocks: [
        {
          type: 'grid', columns: '1fr 1fr', gap: 'xl', align: 'stretch', grow: true,
          children: [
            {
              type: 'stack', justify: 'center',
              children: [
                { type: 'text', variant: 'eyebrow', text: 'Context' },
                { type: 'heading', text: 'Explain the idea next to a visual' },
                { type: 'text', text: 'Two or three sentences that the picture supports.', tone: 'muted' },
              ],
            },
            { type: 'image', src: PLACEHOLDER_IMAGE, alt: 'Placeholder image', aspect: 'fill' },
          ],
        },
      ],
    }),
  },
  {
    id: 'columns',
    label: 'Three cards',
    description: 'Feature or comparison cards with icons',
    icon: 'layout-grid',
    build: () => ({
      name: 'Three cards',
      blocks: [
        { type: 'heading', text: 'Three reasons it works' },
        {
          type: 'grid', columns: 3, gap: 'lg',
          children: ['rocket', 'shield-check', 'target'].map((icon, index) => ({
            type: 'box', accentBar: 'top',
            children: [
              { type: 'icon', name: icon, variant: 'circle' },
              { type: 'heading', level: 3, text: `Reason ${index + 1}` },
              { type: 'text', text: 'A short supporting sentence.', tone: 'muted', size: 'sm' },
            ],
          })),
        },
      ],
    }),
  },
  {
    id: 'kpis',
    label: 'Key numbers',
    description: 'A row of stat tiles',
    icon: 'gauge',
    build: () => ({
      name: 'Key numbers',
      blocks: [
        { type: 'heading', text: 'The numbers that matter' },
        {
          type: 'grid', columns: 3, gap: 'lg',
          children: [
            { type: 'box', children: [{ type: 'stat', value: '42%', label: 'First metric', size: 'xl' }] },
            { type: 'box', children: [{ type: 'stat', value: '3.1×', label: 'Second metric', size: 'xl' }] },
            { type: 'box', children: [{ type: 'stat', value: '$12M', label: 'Third metric', size: 'xl' }] },
          ],
        },
        { type: 'text', variant: 'caption', text: 'Illustrative figures — replace with your own.', tone: 'muted' },
      ],
    }),
  },
  {
    id: 'chart',
    label: 'Chart and insight',
    description: 'A chart beside the point it proves',
    icon: 'chart-column',
    build: () => ({
      name: 'Chart',
      blocks: [
        { type: 'heading', text: 'What the data shows' },
        {
          type: 'grid', columns: '3fr 2fr', gap: 'xl', align: 'stretch', grow: true,
          children: [
            { type: 'chart', kind: 'column', labels: ['2023', '2024', '2025', '2026'], series: [{ name: 'Value', values: [12, 18, 25, 34] }], highlight: 3, caption: 'Illustrative data' },
            { type: 'callout', tone: 'accent', title: 'Insight', text: 'State the one thing the chart proves.' },
          ],
        },
      ],
    }),
  },
  {
    id: 'timeline',
    label: 'Timeline',
    description: 'Milestones or a roadmap',
    icon: 'milestone',
    build: () => ({
      name: 'Timeline',
      blocks: [
        { type: 'heading', text: 'The road ahead' },
        { type: 'timeline', highlight: 1, items: [{ label: 'Q1', title: 'Start' }, { label: 'Q2', title: 'Now' }, { label: 'Q3', title: 'Next' }, { label: 'Q4', title: 'Goal' }] },
      ],
    }),
  },
  {
    id: 'table',
    label: 'Comparison table',
    description: 'Options compared side by side',
    icon: 'table',
    build: () => ({
      name: 'Comparison',
      blocks: [
        { type: 'heading', text: 'How the options compare' },
        { type: 'table', columns: ['', 'Option A', 'Option B'], rows: [['Cost', 'Low', 'High'], ['Speed', 'Fast', 'Faster'], ['Risk', 'Low', 'Medium']], highlightColumn: 1 },
      ],
    }),
  },
  {
    id: 'quote',
    label: 'Quote',
    description: 'A large quotation with attribution',
    icon: 'quote',
    build: () => ({
      name: 'Quote',
      align: 'center',
      blocks: [{ type: 'quote', variant: 'large', text: 'A memorable line worth repeating.', attribution: 'Name', role: 'Role', align: 'center' }],
    }),
  },
  {
    id: 'closing',
    label: 'Closing',
    description: 'Call to action on an accent slide',
    icon: 'flag',
    build: () => ({
      name: 'Closing',
      align: 'center',
      tone: 'accent',
      blocks: [
        { type: 'heading', level: 1, text: 'Thank you', align: 'center' },
        { type: 'text', variant: 'lead', text: 'The one action you want the audience to take.', align: 'center' },
      ],
    }),
  },
]

export function getSlideStarter(id: string): SlideStarter | undefined {
  return slideStarters.find((starter) => starter.id === id)
}
