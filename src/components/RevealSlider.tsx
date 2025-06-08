import React, { useEffect, useRef } from 'react'
import Reveal from 'reveal.js'
import Highlight from 'reveal.js/plugin/highlight/highlight.esm.js'
import Notes from 'reveal.js/plugin/notes/notes.esm.js'
import 'reveal.js/dist/reveal.css'
import 'reveal.js/dist/theme/black.css'
import 'highlight.js/styles/monokai.css'
import type { PresentationConfig } from '../types'

const pluginMap = {
  highlight: Highlight,
  notes: Notes,
}

interface RevealSliderProps {
  config: PresentationConfig
}

const RevealSlider: React.FC<RevealSliderProps> = ({ config }) => {
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!containerRef.current) return
    const { slides, revealOptions, plugins } = config
    if (!Array.isArray(slides) || slides.length === 0) {
      console.error('RevealSlider: invalid or empty slides array', slides)
      return
    }

    const revealEl = document.createElement('div')
    revealEl.className = 'reveal'
    const slidesEl = document.createElement('div')
    slidesEl.className = 'slides'
    slides.forEach((slide) => {
      const section = document.createElement('section')
      if (slide.backgroundImage) {
        section.setAttribute('data-background-image', slide.backgroundImage)
      }
      if (slide.attributes) {
        Object.entries(slide.attributes).forEach(([key, value]) => {
          section.setAttribute(key, value)
        })
      }
      if (slide.title) {
        const h2 = document.createElement('h2')
        h2.innerHTML = slide.title
        section.appendChild(h2)
      }
      if (slide.content) {
        const div = document.createElement('div')
        div.innerHTML = slide.content
        section.appendChild(div)
      }
      slidesEl.appendChild(section)
    })
    revealEl.appendChild(slidesEl)
    containerRef.current.innerHTML = ''
    containerRef.current.appendChild(revealEl)

    const selected = (plugins || []).map((name) => pluginMap[name]).filter(Boolean)
    // initialize a new Reveal.js deck instance for embedded mode
    const deck = new Reveal(revealEl, {
      embedded: true,
      hash: true,
      ...revealOptions,
      plugins: selected,
    })
    deck.initialize()
    return () => {
      try {
        deck.destroy()
      } catch (e) {
        console.warn('RevealSlider: error during deck.destroy()', e)
      }
    }
  }, [config])

  return <div className="reveal-container" ref={containerRef} />
}

export default RevealSlider