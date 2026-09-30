import { useMemo, useState } from 'react'

import { primitives } from '../catalog/registry'
import type { Deck } from '../domain/deckSchema'
import { normalizeDeck } from '../domain/normalize'
import { resolveTheme, themePresetNames, type ThemePresetName } from '../render/theme'
import SlideThumbnail from './SlideThumbnail'

interface PrimitiveGalleryProps {
  onClose: () => void
}

/** Renders every catalog primitive's example on a slide, in any theme, next to its JSON. */
export default function PrimitiveGallery({ onClose }: PrimitiveGalleryProps) {
  const [preset, setPreset] = useState<ThemePresetName>('aurora')
  const [category, setCategory] = useState<string>('all')
  const categories = useMemo(() => ['all', ...new Set(primitives.map((primitive) => primitive.category))], [])
  const theme = useMemo(() => resolveTheme({ preset }), [preset])
  const samples = useMemo(() => primitives
    .filter((primitive) => category === 'all' || primitive.category === category)
    .map((primitive) => {
      const deck = normalizeDeck({ theme: { preset }, slides: [{ id: primitive.type, align: 'center', blocks: [primitive.example] }] }).deck as Deck
      return { primitive, deck }
    }), [preset, category])

  return (
    <main className="v2-gallery" id="main">
      <header className="v2-gallery__header">
        <div>
          <p className="v2-eyebrow">Catalog · {primitives.length} primitives</p>
          <h1>Primitive gallery</h1>
          <p className="v2-muted">The same definitions validate agent output, render slides and generate the agent’s catalog prompt.</p>
        </div>
        <div className="v2-gallery__controls">
          <label className="v2-field">
            <span>Theme</span>
            <select className="v2-input" value={preset} onChange={(event) => setPreset(event.target.value as ThemePresetName)}>
              {themePresetNames.map((name) => <option key={name}>{name}</option>)}
            </select>
          </label>
          <label className="v2-field">
            <span>Category</span>
            <select className="v2-input" value={category} onChange={(event) => setCategory(event.target.value)}>
              {categories.map((name) => <option key={name}>{name}</option>)}
            </select>
          </label>
          <button type="button" className="v2-button v2-button--ghost" onClick={onClose}>Back</button>
        </div>
      </header>
      <div className="v2-gallery__grid">
        {samples.map(({ primitive, deck }) => (
          <article key={primitive.type} className="v2-gallery__item">
            <SlideThumbnail deck={deck} slide={deck.slides[0]} theme={theme} width={420} />
            <div className="v2-gallery__meta">
              <h2><code>{primitive.type}</code> <span className="v2-badge">{primitive.category}</span></h2>
              <p>{primitive.summary}</p>
              {primitive.guidance && <p className="v2-muted v2-small">{primitive.guidance}</p>}
              <details>
                <summary>Example JSON</summary>
                <pre className="v2-code">{JSON.stringify(primitive.example, null, 2)}</pre>
              </details>
            </div>
          </article>
        ))}
      </div>
    </main>
  )
}
