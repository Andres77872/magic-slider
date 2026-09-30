import { useState, type DragEvent } from 'react'

import type { Deck } from '../domain/deckSchema'
import type { FitScales } from '../render/fit'
import type { ResolvedTheme } from '../render/theme'
import SlideThumbnail from './SlideThumbnail'

interface SlideRailProps {
  deck: Deck
  theme: ResolvedTheme
  fitScales: FitScales
  activeIndex: number
  disabled?: boolean
  onSelect: (index: number) => void
  /** Moves a slide after another (null = to the beginning). */
  onMove: (slideId: string, afterSlideId: string | null) => void
}

const THUMB_WIDTH = 168

export default function SlideRail({ deck, theme, fitScales, activeIndex, disabled, onSelect, onMove }: SlideRailProps) {
  const [dragging, setDragging] = useState<string | null>(null)
  const [dropTarget, setDropTarget] = useState<number | null>(null)

  const handleDrop = (event: DragEvent, index: number) => {
    event.preventDefault()
    const slideId = event.dataTransfer.getData('text/x-ms-slide') || dragging
    setDragging(null)
    setDropTarget(null)
    if (!slideId || disabled) return
    const from = deck.slides.findIndex((slide) => slide.id === slideId)
    if (from === -1 || from === index) return
    // Dragging forward drops after the target (so the last position is reachable);
    // dragging backward drops before it.
    if (from < index) {
      onMove(slideId, deck.slides[index].id)
    } else {
      onMove(slideId, index === 0 ? null : deck.slides[index - 1].id)
    }
  }

  return (
    <nav className="v2-rail" aria-label="Slides">
      <ol className="v2-rail__list">
        {deck.slides.map((slide, index) => {
          const scale = fitScales[slide.id]
          return (
            <li key={slide.id} className={`v2-rail__item${dropTarget === index ? ' v2-rail__item--drop' : ''}`}>
              <button
                type="button"
                className={`v2-rail__button${index === activeIndex ? ' v2-rail__button--active' : ''}`}
                aria-current={index === activeIndex ? 'true' : undefined}
                aria-label={`Slide ${index + 1}${slide.name ? `: ${slide.name}` : ''}`}
                draggable={!disabled}
                onClick={() => onSelect(index)}
                onDragStart={(event) => {
                  event.dataTransfer.setData('text/x-ms-slide', slide.id)
                  event.dataTransfer.effectAllowed = 'move'
                  setDragging(slide.id)
                }}
                onDragEnd={() => { setDragging(null); setDropTarget(null) }}
                onDragOver={(event) => { if (dragging && !disabled) { event.preventDefault(); setDropTarget(index) } }}
                onDragLeave={() => setDropTarget((current) => (current === index ? null : current))}
                onDrop={(event) => handleDrop(event, index)}
              >
                <SlideThumbnail deck={deck} slide={slide} theme={theme} fitScale={scale} width={THUMB_WIDTH} />
                <span className="v2-rail__label">
                  <span className="v2-rail__number">{index + 1}</span>
                  <span className="v2-rail__name">{slide.name ?? slide.id}</span>
                  {scale !== undefined && scale < 0.9 && <span className="v2-rail__fit" title={`Content scaled to ${Math.round(scale * 100)}% to fit`}>fit {Math.round(scale * 100)}%</span>}
                </span>
              </button>
            </li>
          )
        })}
      </ol>
    </nav>
  )
}
