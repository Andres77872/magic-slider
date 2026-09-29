import { useEffect, useRef } from 'react'

import type { SlideLayout } from '../domain/presentationSchema'
import type { ValidatedPresentationConfig, ValidatedSlide } from '../domain/presentationTypes'
import { isSafeImageUrl } from '../presentation/imageUrl'
import { DEFAULT_THEME, resolveSlideLayout } from '../presentation/safeSlideRenderer'

interface SlideNavigatorProps {
  deck: ValidatedPresentationConfig
  currentIndex: number
  disabled?: boolean
  onSelect: (index: number) => void
}

const layoutLabels: Record<SlideLayout, string> = {
  title: 'Title',
  section: 'Section',
  content: 'Content',
  split: 'Image + text',
  statement: 'Statement',
  quote: 'Quote',
  stats: 'Key figures',
  comparison: 'Comparison',
  timeline: 'Timeline',
  closing: 'Closing',
}

export function slidePreviewImage(slide: ValidatedSlide): string | undefined {
  const url = slide.backgroundImage ?? slide.background ?? slide.image?.url
  return url && isSafeImageUrl(url) ? url : undefined
}

export function slideLabel(slide: ValidatedSlide, index: number): string {
  return slide.title?.trim() || slide.kicker?.trim() || slide.quote?.text.slice(0, 60) || `Slide ${index + 1}`
}

export default function SlideNavigator({ deck, currentIndex, disabled, onSelect }: SlideNavigatorProps) {
  const listRef = useRef<HTMLOListElement>(null)

  useEffect(() => {
    const current = listRef.current?.querySelector<HTMLElement>('[aria-current="true"]')
    current?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' })
  }, [currentIndex])

  return (
    <nav className="slide-navigator" aria-label="Slides" data-testid="slide-navigator">
      <ol ref={listRef} className={`slide-navigator__list theme-swatch--${deck.theme ?? DEFAULT_THEME}`}>
        {deck.slides.map((slide, index) => {
          const layout = resolveSlideLayout(slide)
          const image = slidePreviewImage(slide)
          const label = slideLabel(slide, index)
          return (
            <li key={index}>
              <button
                type="button"
                className={`slide-thumb slide-thumb--${layout}${image ? ' slide-thumb--image' : ''}`}
                aria-current={index === currentIndex ? 'true' : undefined}
                aria-label={`Slide ${index + 1}: ${label} (${layoutLabels[layout]})`}
                title={label}
                disabled={disabled}
                onClick={() => onSelect(index)}
              >
                <span className="slide-thumb__canvas" aria-hidden="true">
                  {image && <img src={image} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" />}
                  <span className="slide-thumb__title">{label}</span>
                  <span className="slide-thumb__layout">{layoutLabels[layout]}</span>
                </span>
                <span className="slide-thumb__number" aria-hidden="true">{index + 1}</span>
              </button>
            </li>
          )
        })}
      </ol>
    </nav>
  )
}
