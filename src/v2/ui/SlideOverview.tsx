import type { Deck } from '../domain/deckSchema'
import type { FitScales } from '../render/fit'
import type { ResolvedTheme } from '../render/theme'
import SlideThumbnail from './SlideThumbnail'

interface SlideOverviewProps {
  deck: Deck
  theme: ResolvedTheme
  fitScales: FitScales
  activeIndex: number
  onOpen: (index: number) => void
}

const OVERVIEW_WIDTH = 360

/** Slide sorter: every slide at a readable size, for reviewing rhythm and consistency. */
export default function SlideOverview({ deck, theme, fitScales, activeIndex, onOpen }: SlideOverviewProps) {
  return (
    <div className="v2-overview" role="list" aria-label="All slides">
      {deck.slides.map((slide, index) => (
        <button
          key={slide.id}
          type="button"
          role="listitem"
          className={`v2-overview__item${index === activeIndex ? ' v2-overview__item--active' : ''}`}
          aria-label={`Open slide ${index + 1}${slide.name ? `: ${slide.name}` : ''}`}
          onClick={() => onOpen(index)}
        >
          <SlideThumbnail deck={deck} slide={slide} theme={theme} fitScale={fitScales[slide.id]} width={OVERVIEW_WIDTH} />
          <span className="v2-overview__label"><strong>{index + 1}</strong> {slide.name ?? slide.id}</span>
        </button>
      ))}
    </div>
  )
}
