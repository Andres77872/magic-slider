import { defaultBriefPreferences, type BriefPreferences } from './briefPreferences'

export type ExampleCategoryId = 'featured' | 'business' | 'education' | 'research' | 'technical' | 'marketing' | 'personal'

export interface PresentationExample {
  id: string
  category: Exclude<ExampleCategoryId, 'featured'>
  featured?: boolean
  title: string
  /** Who it is for and what it shows off, in a few words. */
  description: string
  prompt: string
  preferences: Partial<BriefPreferences>
}

export const exampleCategories: ReadonlyArray<{ id: ExampleCategoryId; label: string }> = [
  { id: 'featured', label: 'Featured' },
  { id: 'business', label: 'Business' },
  { id: 'education', label: 'Education' },
  { id: 'research', label: 'Research & data' },
  { id: 'technical', label: 'Technical' },
  { id: 'marketing', label: 'Marketing' },
  { id: 'personal', label: 'Personal & events' },
]

export const presentationExamples: readonly PresentationExample[] = [
  {
    id: 'investor-pitch',
    category: 'business',
    featured: true,
    title: 'Investor pitch',
    description: 'Market size, competitors and a clear ask',
    prompt: 'An investor pitch for a mobile app that helps households reduce food waste: the problem, our solution, market size, business model, competitors and the funding ask.',
    preferences: { slideCount: '12', audience: 'Investors', tone: 'Persuasive', theme: 'aurora' },
  },
  {
    id: 'quarterly-review',
    category: 'business',
    title: 'Quarterly business review',
    description: 'A reusable template with placeholders',
    prompt: 'A quarterly business review template for a SaaS startup: highlights, revenue and retention, pipeline, risks and next-quarter priorities. Use clearly marked placeholders for our numbers.',
    preferences: { slideCount: '8', audience: 'Executives', tone: 'Formal', theme: 'ocean', research: false, images: false },
  },
  {
    id: 'strategy-offsite',
    category: 'business',
    title: 'Strategy offsite kickoff',
    description: 'Frame the day and the decisions',
    prompt: 'Kick off our annual strategy offsite: where we stand, three strategic bets to debate, how we will decide, and the agenda for the day.',
    preferences: { slideCount: '8', audience: 'Executives', tone: 'Inspiring', theme: 'ember', research: false },
  },
  {
    id: 'how-llms-work',
    category: 'education',
    featured: true,
    title: 'Teach a concept',
    description: 'How large language models work',
    prompt: 'A beginner-friendly introduction to how large language models work, with everyday analogies, what they can and cannot do, and tips for using them well.',
    preferences: { slideCount: '8', audience: 'Students', tone: 'Conversational', theme: 'paper' },
  },
  {
    id: 'water-cycle-es',
    category: 'education',
    title: 'Clase en español',
    description: 'El ciclo del agua para primaria',
    prompt: 'Crea una clase sobre el ciclo del agua para alumnos de quinto de primaria: evaporación, condensación, precipitación y cómo cuidar el agua en casa.',
    preferences: { slideCount: '5', audience: 'Students', tone: 'Conversational', theme: 'forest', research: false },
  },
  {
    id: 'inflation-lecture',
    category: 'education',
    title: 'University lecture',
    description: 'Economics with current data',
    prompt: 'A first-year economics lecture on what causes inflation, comparing demand-pull and cost-push explanations with recent data from the United States and Europe.',
    preferences: { slideCount: '8', audience: 'Students', tone: 'Informative', theme: 'paper' },
  },
  {
    id: 'energy-briefing',
    category: 'research',
    featured: true,
    title: 'Research briefing',
    description: 'Current figures with cited sources',
    prompt: 'A briefing on the state of solar and wind power this year for a city council: growth, costs, grid challenges and what cities can do, with key figures and sources.',
    preferences: { slideCount: '8', audience: 'Executives', tone: 'Informative', theme: 'ocean' },
  },
  {
    id: 'report-summary',
    category: 'research',
    title: 'Summarize a report',
    description: 'Paste a link, get the key points',
    prompt: 'Summarize this report into a deck for executives, covering every major section: https://www.iea.org/reports/electricity-2026/executive-summary',
    preferences: { slideCount: '5', audience: 'Executives', tone: 'Formal', theme: 'ocean', images: false },
  },
  {
    id: 'health-trends',
    category: 'research',
    title: 'Data explainer',
    description: 'Public-health trends and what works',
    prompt: 'Explain global trends in adult obesity and the interventions with the strongest evidence, using WHO and peer-reviewed data.',
    preferences: { slideCount: '8', audience: 'General audience', tone: 'Informative', theme: 'forest' },
  },
  {
    id: 'python-async',
    category: 'technical',
    featured: true,
    title: 'Code walkthrough',
    description: 'Highlighted code examples',
    prompt: 'An introduction to async/await in Python for junior developers, with short code examples, a common mistake to avoid, and when not to use it.',
    preferences: { slideCount: '8', audience: 'Technical team', tone: 'Informative', theme: 'midnight', images: false },
  },
  {
    id: 'architecture-proposal',
    category: 'technical',
    title: 'Architecture proposal',
    description: 'Trade-offs, migration plan and risks',
    prompt: 'A proposal to move our monolith to event-driven services: current pain points, the target architecture, trade-offs, a phased migration plan and risks.',
    preferences: { slideCount: '8', audience: 'Technical team', tone: 'Formal', theme: 'aurora', research: false },
  },
  {
    id: 'security-training',
    category: 'technical',
    title: 'Security awareness',
    description: 'Practical training for every employee',
    prompt: 'Security awareness training for all employees: strong passwords and passkeys, spotting phishing, multifactor authentication and what to do after a mistake.',
    preferences: { slideCount: '8', audience: 'General audience', tone: 'Conversational', theme: 'midnight' },
  },
  {
    id: 'product-launch',
    category: 'marketing',
    featured: true,
    title: 'Product launch',
    description: 'Benefit-led story with visuals',
    prompt: 'Launch presentation for a smart water bottle that tracks hydration and reminds you to drink: the problem, key features, who it is for, pricing and availability.',
    preferences: { slideCount: '8', audience: 'Customers', tone: 'Inspiring', theme: 'ember', research: false },
  },
  {
    id: 'case-study',
    category: 'marketing',
    title: 'Customer case study',
    description: 'Challenge, solution and results',
    prompt: 'A customer case study: how a regional bakery chain cut its energy bills by switching to heat pumps, with the challenge, the solution, results and a quote placeholder.',
    preferences: { slideCount: '5', audience: 'Customers', tone: 'Persuasive', theme: 'forest', research: false },
  },
  {
    id: 'campaign-plan',
    category: 'marketing',
    title: 'Campaign plan',
    description: 'Goals, audience, channels and timeline',
    prompt: 'A campaign plan for a local bookstore summer reading challenge: goals, audience, key message, channels, timeline and how we will measure success.',
    preferences: { slideCount: '8', audience: 'Customers', tone: 'Conversational', theme: 'paper', research: false },
  },
  {
    id: 'farewell',
    category: 'personal',
    featured: true,
    title: 'Farewell tribute',
    description: 'Warm, personal and a little fun',
    prompt: 'A warm and fun farewell presentation for Maria, our office manager, who is retiring after 30 years: her impact, what we will miss, and good wishes for what comes next.',
    preferences: { slideCount: '5', audience: 'General audience', tone: 'Conversational', theme: 'ember', research: false },
  },
  {
    id: 'trip-recap',
    category: 'personal',
    title: 'Trip recap',
    description: 'Highlights and lessons with imagery',
    prompt: 'A recap of our team trip to Kyoto: the itinerary, favorite moments, what we learned about working together, and ideas for next year.',
    preferences: { slideCount: '5', audience: 'General audience', tone: 'Conversational', theme: 'forest', research: false },
  },
  {
    id: 'book-club',
    category: 'personal',
    title: 'Book club guide',
    description: 'Themes and discussion questions',
    prompt: 'A book club discussion guide for "The Remains of the Day" by Kazuo Ishiguro: context about the author, main themes, key moments and open discussion questions.',
    preferences: { slideCount: '5', audience: 'General audience', tone: 'Conversational', theme: 'paper' },
  },
]

export function examplesFor(category: ExampleCategoryId): PresentationExample[] {
  return presentationExamples.filter((example) => (category === 'featured' ? example.featured : example.category === category))
}

/** Presets start from the defaults so a previous choice never leaks into an example. */
export function examplePreferences(example: PresentationExample): BriefPreferences {
  return { ...defaultBriefPreferences, ...example.preferences }
}

/** Short capability summary shown on each card. */
export function exampleHighlights(example: PresentationExample): string[] {
  const preferences = examplePreferences(example)
  return [
    preferences.slideCount === 'auto' ? 'Auto length' : `${preferences.slideCount} slides`,
    preferences.research ? 'Web research' : null,
    preferences.images ? 'Images' : null,
  ].filter((value): value is string => Boolean(value))
}
