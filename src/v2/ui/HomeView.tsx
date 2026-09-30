import { useRef, useState, type ChangeEvent, type KeyboardEvent } from 'react'

import { audienceOptions, toneOptions } from '../../lib/briefPreferences'
import { presentationExamples } from '../../lib/exampleCatalog'
import { themePresetNames, themePresets, type ThemePresetName } from '../render/theme'
import type { SessionSummary } from '../session/sessions'
import { deckTemplates, type DeckTemplate } from '../templates'

export interface BriefOptions {
  slideCount: 'auto' | '5' | '8' | '12'
  audience: string
  tone: string
  theme: 'auto' | ThemePresetName
  research: boolean
  images: boolean
}

export const defaultBriefOptions: BriefOptions = { slideCount: 'auto', audience: '', tone: '', theme: 'auto', research: true, images: true }

/** The agent reads choices from one labelled line, so requests stay readable in history. */
export function withBriefOptions(prompt: string, options: BriefOptions): string {
  const parts: string[] = []
  if (options.slideCount !== 'auto') parts.push(`${options.slideCount} slides`)
  if (options.audience) parts.push(`Audience: ${options.audience}`)
  if (options.tone) parts.push(`Tone: ${options.tone}`)
  if (options.theme !== 'auto') parts.push(`Theme: ${options.theme}`)
  if (!options.research) parts.push('Web research: off')
  if (!options.images) parts.push('Generated images: off')
  return parts.length ? `${prompt.trimEnd()}\n\nPresentation preferences: ${parts.join(' · ')}` : prompt
}

interface HomeViewProps {
  sessions: SessionSummary[]
  disabled?: boolean
  busy?: boolean
  error?: string | null
  onGenerate: (prompt: string) => void
  onTemplate: (template: DeckTemplate) => void
  onImport: (json: string, fileName: string) => void
  onOpenSession: (id: string) => void
  onDeleteSession: (id: string) => void
  onOpenGallery: () => void
  /** Starts an empty deck to build by hand. */
  onBlank?: () => void
}

const featured = presentationExamples.filter((example) => example.featured).concat(presentationExamples.filter((example) => !example.featured)).slice(0, 8)

export default function HomeView({ sessions, disabled, busy, error, onGenerate, onTemplate, onImport, onOpenSession, onDeleteSession, onOpenGallery, onBlank }: HomeViewProps) {
  const [prompt, setPrompt] = useState('')
  const [options, setOptions] = useState<BriefOptions>(defaultBriefOptions)
  const [showOptions, setShowOptions] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const submit = () => {
    if (!prompt.trim() || disabled || busy) return
    onGenerate(withBriefOptions(prompt.trim(), options))
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault()
      submit()
    }
  }

  const handleFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    onImport(await file.text(), file.name)
  }

  const update = <Key extends keyof BriefOptions>(key: Key, value: BriefOptions[Key]) => setOptions((current) => ({ ...current, [key]: value }))

  return (
    <main className="v2-home" id="main">
      <section className="v2-hero">
        <p className="v2-eyebrow">Magic Slider v2 · primitive studio</p>
        <h1 className="v2-hero__title">Describe it. <span>Watch it compose.</span></h1>
        <p className="v2-hero__lead">Researched facts become charts, stats, timelines and diagrams — composed from flexible primitives you can refine slide by slide, block by block.</p>

        <div className="v2-brief" aria-busy={busy ? 'true' : undefined}>
          <label className="v2-visually-hidden" htmlFor="v2-brief">Describe your presentation</label>
          <textarea
            id="v2-brief"
            className="v2-input v2-brief__input"
            rows={4}
            value={prompt}
            placeholder="Topic, audience and goal… e.g. “A 9-slide board update on our Q3 growth, churn and next-quarter plan”"
            onChange={(event) => setPrompt(event.target.value)}
            onKeyDown={handleKeyDown}
            disabled={disabled || busy}
            maxLength={8_000}
          />
          <div className="v2-brief__bar">
            <button type="button" className="v2-link" aria-expanded={showOptions} onClick={() => setShowOptions((open) => !open)}>
              {showOptions ? '− Options' : '+ Options'}
              <span className="v2-muted"> · {options.slideCount === 'auto' ? 'auto length' : `${options.slideCount} slides`} · {options.theme === 'auto' ? 'auto theme' : options.theme} · research {options.research ? 'on' : 'off'} · images {options.images ? 'on' : 'off'}</span>
            </button>
            <button type="button" className="v2-button v2-button--primary v2-button--lg" onClick={submit} disabled={!prompt.trim() || disabled || busy}>
              {busy ? 'Composing…' : 'Generate'}
            </button>
          </div>
          {showOptions && (
            <div className="v2-options">
              <fieldset className="v2-field">
                <legend>Length</legend>
                <div className="v2-segmented">
                  {(['auto', '5', '8', '12'] as const).map((count) => (
                    <label key={count}><input type="radio" name="v2-length" checked={options.slideCount === count} onChange={() => update('slideCount', count)} /><span>{count === 'auto' ? 'Auto' : count}</span></label>
                  ))}
                </div>
              </fieldset>
              <label className="v2-field">
                <span>Audience</span>
                <select className="v2-input" value={options.audience} onChange={(event) => update('audience', event.target.value)}>
                  <option value="">Let Magic Slider decide</option>
                  {audienceOptions.map((option) => <option key={option}>{option}</option>)}
                </select>
              </label>
              <label className="v2-field">
                <span>Tone</span>
                <select className="v2-input" value={options.tone} onChange={(event) => update('tone', event.target.value)}>
                  <option value="">Let Magic Slider decide</option>
                  {toneOptions.map((option) => <option key={option}>{option}</option>)}
                </select>
              </label>
              <fieldset className="v2-field v2-field--wide">
                <legend>Theme</legend>
                <div className="v2-themes">
                  <label className="v2-theme"><input type="radio" name="v2-theme" checked={options.theme === 'auto'} onChange={() => update('theme', 'auto')} /><span className="v2-theme__swatch v2-theme__swatch--auto" /><span>Auto</span></label>
                  {themePresetNames.map((name) => (
                    <label key={name} className="v2-theme">
                      <input type="radio" name="v2-theme" checked={options.theme === name} onChange={() => update('theme', name)} />
                      <span className="v2-theme__swatch" style={{ background: `linear-gradient(135deg, ${themePresets[name].background} 55%, ${themePresets[name].accent} 55%, ${themePresets[name].accent2})` }} />
                      <span>{name}</span>
                    </label>
                  ))}
                </div>
              </fieldset>
              <div className="v2-field v2-field--wide v2-toggles">
                <label className="v2-switch"><input type="checkbox" checked={options.research} onChange={(event) => update('research', event.target.checked)} /><span>Web research with cited sources</span></label>
                <label className="v2-switch"><input type="checkbox" checked={options.images} onChange={(event) => update('images', event.target.checked)} /><span>Original generated images</span></label>
              </div>
            </div>
          )}
          {error && <p className="v2-alert" role="alert">{error}</p>}
        </div>
      </section>

      <section className="v2-home__section" aria-labelledby="v2-examples-title">
        <h2 id="v2-examples-title">Try an example</h2>
        <div className="v2-cards">
          {featured.map((example) => (
            <button
              key={example.id}
              type="button"
              className="v2-card"
              disabled={disabled || busy}
              onClick={() => {
                setPrompt(example.prompt)
                setOptions({ ...defaultBriefOptions, ...example.preferences, theme: (example.preferences.theme as ThemePresetName | undefined) ?? 'auto' } as BriefOptions)
                setShowOptions(true)
              }}
            >
              <strong>{example.title}</strong>
              <span>{example.description}</span>
            </button>
          ))}
        </div>
      </section>

      <section className="v2-home__section" aria-labelledby="v2-start-title">
        <h2 id="v2-start-title">Start without generating</h2>
        <div className="v2-cards">
          {onBlank && (
            <button type="button" className="v2-card v2-card--template" disabled={disabled || busy} onClick={onBlank}>
              <strong>Blank presentation</strong>
              <span>Build it yourself from layouts and blocks; ask the assistant any time</span>
            </button>
          )}
          {deckTemplates.map((template) => (
            <button key={template.id} type="button" className="v2-card v2-card--template" disabled={disabled || busy} onClick={() => onTemplate(template)}>
              <strong>{template.title}</strong>
              <span>{template.description}</span>
            </button>
          ))}
          <button type="button" className="v2-card v2-card--template" disabled={disabled || busy} onClick={() => fileRef.current?.click()}>
            <strong>Import JSON</strong>
            <span>A v2 deck, or a v1 export converted to primitives</span>
          </button>
          <button type="button" className="v2-card v2-card--template" onClick={onOpenGallery}>
            <strong>Primitive gallery</strong>
            <span>Every building block the agent can use</span>
          </button>
          <input ref={fileRef} type="file" accept="application/json,.json" hidden onChange={(event) => void handleFile(event)} />
        </div>
      </section>

      {sessions.length > 0 && (
        <section className="v2-home__section" aria-labelledby="v2-recent-title">
          <h2 id="v2-recent-title">Recent</h2>
          <ul className="v2-recent">
            {sessions.map((session) => (
              <li key={session.id}>
                <button type="button" className="v2-recent__open" disabled={busy} onClick={() => onOpenSession(session.id)}>
                  <strong>{session.title}</strong>
                  <span className="v2-muted">{session.slideCount} slides{session.theme ? ` · ${session.theme}` : ''} · {new Date(session.updatedAt).toLocaleString()}</span>
                </button>
                <button type="button" className="v2-link v2-recent__delete" aria-label={`Delete ${session.title}`} disabled={busy} onClick={() => onDeleteSession(session.id)}>Delete</button>
              </li>
            ))}
          </ul>
          <p className="v2-muted v2-small">Saved only in this browser.</p>
        </section>
      )}
    </main>
  )
}
