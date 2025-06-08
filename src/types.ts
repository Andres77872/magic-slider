export interface Slide {
  title?: string
  content?: string
  backgroundImage?: string
  attributes?: Record<string, string>
}

export interface PresentationConfig {
  revealOptions?: Record<string, unknown>
  plugins?: ('highlight' | 'notes')[]
  slides: Slide[]
}