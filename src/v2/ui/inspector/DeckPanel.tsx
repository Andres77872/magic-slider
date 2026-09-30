import { useEffect, useId, useState } from 'react'

import { isHexColor } from '../../catalog/tokens'
import type { Deck } from '../../domain/deckSchema'
import { revealTransitions } from '../../domain/deckSchema'
import { decorations, fontNames, resolveTheme, themeColorKeys, themePresetNames, themePresets, type ThemePresetName } from '../../render/theme'
import Icon from '../common/Icon'
import { BooleanField, EnumField, FieldShell, TextField } from './fields'
import type { FieldDef } from './fieldModel'

interface DeckPanelProps {
  deck: Deck
  disabled?: boolean
  /** Applies an update_deck set; returns an error message or null. */
  onSet: (set: Record<string, unknown>, summary: string) => string | null
}

const field = (key: string, label: string, kind: FieldDef['kind'], extra: Partial<FieldDef> = {}): FieldDef => ({ key, label, kind, group: 'style', required: false, schema: {}, ...extra })

function ColorOverride({ name, value, fallback, disabled, onCommit }: { name: string; value: string | undefined; fallback: string; disabled?: boolean; onCommit: (value: string | null) => void }) {
  const id = useId()
  const [draft, setDraft] = useState(value ?? '')
  useEffect(() => setDraft(value ?? ''), [value])
  const commit = (next: string) => {
    if (next === (value ?? '')) return
    if (!next) onCommit(null)
    else if (isHexColor(next)) onCommit(next)
  }
  return (
    <div className="v2-colorrow">
      <label htmlFor={id}>{name}</label>
      <input type="color" aria-label={`${name} color picker`} value={isHexColor(draft) && draft.length === 7 ? draft : fallback} disabled={disabled} onChange={(event) => setDraft(event.target.value)} onBlur={() => commit(draft)} />
      <input id={id} className="v2-input v2-input--mono" placeholder={fallback} value={draft} disabled={disabled} onChange={(event) => setDraft(event.target.value)} onBlur={() => commit(draft.trim())} onKeyDown={(event) => { if (event.key === 'Enter') commit(draft.trim()) }} />
      <button type="button" className="v2-mini" aria-label={`Reset ${name}`} title="Use the preset color" disabled={disabled || !value} onClick={() => onCommit(null)}><Icon name="x" size={12} /></button>
    </div>
  )
}

/** Deck-level design: title, language, theme preset, fonts, colors and viewer settings. */
export default function DeckPanel({ deck, disabled, onSet }: DeckPanelProps) {
  const theme = resolveTheme(deck.theme)
  const presetId = useId()
  const settings = deck.settings ?? {}
  const setTheme = (patch: Record<string, unknown>, summary: string) => onSet({ theme: patch }, summary)
  const setSetting = (key: string, value: unknown) => onSet({ settings: { ...settings, [key]: value === null ? undefined : value } }, `Changed the ${key} setting.`)

  return (
    <div className="v2-fields">
      <section className="v2-section">
        <h3 className="v2-section__title">Presentation</h3>
        <TextField field={field('title', 'Title', 'text', { maxLength: 200 })} value={deck.title} disabled={disabled} onCommit={(value) => onSet({ title: value }, 'Renamed the presentation.')} />
        <TextField field={field('language', 'Language (BCP 47)', 'text', { maxLength: 35 })} value={deck.language} disabled={disabled} onCommit={(value) => onSet({ language: value }, 'Changed the language.')} />
      </section>

      <section className="v2-section">
        <h3 className="v2-section__title" id={presetId}>Theme</h3>
        <div className="v2-swatches" role="radiogroup" aria-labelledby={presetId}>
          {themePresetNames.map((name: ThemePresetName) => {
            const preset = themePresets[name]
            return (
              <button
                key={name}
                type="button"
                role="radio"
                aria-checked={theme.preset === name}
                className="v2-swatch"
                disabled={disabled}
                onClick={() => theme.preset !== name && setTheme({ preset: name }, `Switched to the ${name} theme.`)}
              >
                <span className="v2-swatch__chip" style={{ background: preset.background, color: preset.text }}>
                  <span style={{ background: preset.accent }} />
                  <span style={{ background: preset.accent2 }} />
                  Aa
                </span>
                <span className="v2-swatch__name">{name}</span>
              </button>
            )
          })}
        </div>
        <EnumField field={field('heading', 'Heading font', 'enum', { options: [...fontNames] })} value={deck.theme?.fonts?.heading} disabled={disabled} onCommit={(value) => setTheme({ fonts: { heading: value ?? undefined } }, 'Changed the heading font.')} />
        <EnumField field={field('body', 'Body font', 'enum', { options: [...fontNames] })} value={deck.theme?.fonts?.body} disabled={disabled} onCommit={(value) => setTheme({ fonts: { body: value ?? undefined } }, 'Changed the body font.')} />
        <EnumField field={field('radius', 'Corner radius', 'enum', { options: ['none', 'sm', 'md', 'lg', 'xl'] })} value={deck.theme?.radius} disabled={disabled} onCommit={(value) => setTheme({ radius: value ?? undefined }, 'Changed the corner radius.')} />
        <EnumField field={field('decoration', 'Decoration', 'enum', { options: [...decorations] })} value={deck.theme?.decoration} disabled={disabled} onCommit={(value) => setTheme({ decoration: value ?? undefined }, 'Changed the decoration.')} />
        <FieldShell field={{ label: 'Colors', required: false }} id={`${presetId}-colors`}>
          <div className="v2-colorrows" id={`${presetId}-colors`}>
            {themeColorKeys.map((key) => (
              <ColorOverride
                key={key}
                name={key}
                value={deck.theme?.colors?.[key]}
                fallback={theme.colors[key as keyof typeof theme.colors] ?? '#000000'}
                disabled={disabled}
                onCommit={(value) => setTheme({ colors: { ...deck.theme?.colors, [key]: value ?? undefined } }, value ? `Set the ${key} color.` : `Reset the ${key} color.`)}
              />
            ))}
          </div>
        </FieldShell>
      </section>

      <section className="v2-section">
        <h3 className="v2-section__title">Viewer</h3>
        <EnumField field={field('aspectRatio', 'Aspect ratio', 'enum', { options: ['16:9', '4:3'] })} value={settings.aspectRatio} disabled={disabled} onCommit={(value) => setSetting('aspectRatio', value)} />
        <EnumField field={field('transition', 'Transition', 'enum', { options: [...revealTransitions] })} value={settings.transition} disabled={disabled} onCommit={(value) => setSetting('transition', value)} />
        <EnumField field={field('transitionSpeed', 'Transition speed', 'enum', { options: ['default', 'fast', 'slow'] })} value={settings.transitionSpeed} disabled={disabled} onCommit={(value) => setSetting('transitionSpeed', value)} />
        <BooleanField field={field('controls', 'Navigation arrows', 'boolean')} value={settings.controls ?? true} disabled={disabled} onCommit={(value) => setSetting('controls', value === true)} />
        <BooleanField field={field('progress', 'Progress bar', 'boolean')} value={settings.progress ?? true} disabled={disabled} onCommit={(value) => setSetting('progress', value === true)} />
        <BooleanField field={field('slideNumber', 'Slide numbers', 'boolean')} value={settings.slideNumber ?? false} disabled={disabled} onCommit={(value) => setSetting('slideNumber', value === true)} />
        <BooleanField field={field('autoFit', 'Shrink overfull slides to fit', 'boolean')} value={settings.autoFit ?? true} disabled={disabled} onCommit={(value) => setSetting('autoFit', value === true)} />
      </section>
    </div>
  )
}
