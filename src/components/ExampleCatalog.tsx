import { useRef, useState, type KeyboardEvent } from 'react'

import {
  exampleCategories,
  exampleHighlights,
  examplePreferences,
  examplesFor,
  type ExampleCategoryId,
  type PresentationExample,
} from '../lib/exampleCatalog'

interface ExampleCatalogProps {
  selectedId?: string | null
  disabled?: boolean
  onSelect: (example: PresentationExample) => void
}

const categoryLabels = Object.fromEntries(exampleCategories.map((category) => [category.id, category.label])) as Record<ExampleCategoryId, string>

export default function ExampleCatalog({ selectedId, disabled, onSelect }: ExampleCatalogProps) {
  const [category, setCategory] = useState<ExampleCategoryId>('featured')
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([])
  const examples = examplesFor(category)

  // Tabs follow the WAI-ARIA pattern: arrows move between categories, Home/End jump.
  const handleTabKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const last = exampleCategories.length - 1
    const next = event.key === 'ArrowRight' ? (index === last ? 0 : index + 1)
      : event.key === 'ArrowLeft' ? (index === 0 ? last : index - 1)
        : event.key === 'Home' ? 0
          : event.key === 'End' ? last
            : null
    if (next === null) return
    event.preventDefault()
    setCategory(exampleCategories[next].id)
    tabRefs.current[next]?.focus()
  }

  return (
    <section className="example-catalog" aria-labelledby="example-catalog-title" data-testid="example-catalog">
      <div className="example-catalog__header">
        <h4 id="example-catalog-title" className="example-catalog__title">Start from an example</h4>
        <p className="example-catalog__hint">Fills in the request and its options. Edit anything before generating.</p>
      </div>

      <div className="example-catalog__tabs" role="tablist" aria-label="Example categories">
        {exampleCategories.map((item, index) => (
          <button
            key={item.id}
            ref={(element) => { tabRefs.current[index] = element }}
            type="button"
            role="tab"
            id={`example-tab-${item.id}`}
            aria-selected={category === item.id}
            aria-controls="example-catalog-panel"
            tabIndex={category === item.id ? 0 : -1}
            className="example-catalog__tab"
            onClick={() => setCategory(item.id)}
            onKeyDown={(event) => handleTabKeyDown(event, index)}
          >
            {item.label}
          </button>
        ))}
      </div>

      <div
        id="example-catalog-panel"
        className="example-catalog__grid"
        role="tabpanel"
        aria-labelledby={`example-tab-${category}`}
      >
        {examples.map((example) => {
          const theme = examplePreferences(example).theme
          const selected = selectedId === example.id
          return (
            <button
              key={example.id}
              type="button"
              className="example-card"
              aria-pressed={selected}
              disabled={disabled}
              onClick={() => onSelect(example)}
              data-testid={`example-${example.id}`}
            >
              <span className="example-card__top">
                {/* The category is only news on the mixed Featured tab. */}
                <span className="example-card__category">{category === 'featured' ? categoryLabels[example.category] : ''}</span>
                {theme !== 'auto' && (
                  <span className={`example-card__theme theme-swatch--${theme}`} title={`${theme} theme`}>
                    <span className="example-card__swatch" aria-hidden="true" />
                    {theme}
                  </span>
                )}
              </span>
              <span className="example-card__title">{example.title}</span>
              <span className="example-card__description">{example.description}</span>
              <span className="example-card__prompt">{example.prompt}</span>
              <span className="example-card__meta">
                {exampleHighlights(example).map((highlight) => (
                  <span key={highlight} className="example-card__badge">{highlight}</span>
                ))}
                <span className="example-card__use" aria-hidden="true">{selected ? 'Loaded ✓' : 'Use example →'}</span>
              </span>
            </button>
          )
        })}
      </div>
    </section>
  )
}
