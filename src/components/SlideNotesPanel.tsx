import type { ValidatedSlide } from '../domain/presentationTypes'
import { isSafeLinkUrl, linkHost } from '../presentation/imageUrl'

interface SlideNotesPanelProps {
  slide: ValidatedSlide | undefined
  slideNumber: number
}

export default function SlideNotesPanel({ slide, slideNumber }: SlideNotesPanelProps) {
  const sources = slide?.sources ?? []
  return (
    <section className="notes-panel" aria-label={`Speaker notes for slide ${slideNumber}`} data-testid="slide-notes-panel">
      <div className="notes-panel__column">
        <p className="eyebrow">Speaker notes · Slide {slideNumber}</p>
        {slide?.notes?.trim() ? (
          <p className="notes-panel__text">{slide.notes}</p>
        ) : (
          <p className="notes-panel__empty">No notes for this slide. Ask the chat to “add speaker notes”.</p>
        )}
      </div>
      <div className="notes-panel__column notes-panel__column--sources">
        <p className="eyebrow">Sources</p>
        {sources.length ? (
          <ol className="notes-panel__sources">
            {sources.map((source, index) => (
              <li key={`${source.url}-${index}`}>
                {isSafeLinkUrl(source.url) ? (
                  <a href={source.url} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer">
                    {source.title}
                    <span className="notes-panel__host">{linkHost(source.url)}</span>
                  </a>
                ) : source.title}
              </li>
            ))}
          </ol>
        ) : (
          <p className="notes-panel__empty">No sources cited on this slide.</p>
        )}
        {slide?.image && <p className="notes-panel__alt"><span>Image description:</span> {slide.image.alt}</p>}
      </div>
    </section>
  )
}
