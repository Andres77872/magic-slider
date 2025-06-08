import Reveal from 'reveal.js'
import Highlight from 'reveal.js/plugin/highlight/highlight.esm.js'
import Notes from 'reveal.js/plugin/notes/notes.esm.js'

import 'reveal.js/dist/reveal.css'
import 'reveal.js/dist/theme/black.css'

interface Slide {
  title?: string
  content?: string
  backgroundImage?: string
  attributes?: Record<string, string>
}

interface PresentationConfig {
  revealOptions?: Record<string, unknown>
  plugins?: ('highlight' | 'notes')[]
  slides: Slide[]
}

const pluginMap: Record<string, any> = {
  highlight: Highlight,
  notes: Notes,
}

class MagicSlider extends HTMLElement {
  async connectedCallback() {
    // Listen for slidesGenerated event
    this.addEventListener('slidesGenerated', ((event: CustomEvent<PresentationConfig>) => {
      this.renderSlides(event.detail)
    }) as EventListener)

    const templateAttr = this.getAttribute('template')
    const params = new URLSearchParams(window.location.search)
    const template = templateAttr || params.get('template') || 'basic'

    // Check if we have generated slides in localStorage
    const generatedSlides = localStorage.getItem('generatedSlides')
    if (generatedSlides) {
      try {
        const config = JSON.parse(generatedSlides) as PresentationConfig
        this.renderSlides(config)
        return
      } catch (error) {
        console.error('Failed to parse generated slides:', error)
        // Continue with template loading if parsing fails
      }
    }

    try {
      const response = await fetch(`/templates/${template}.json`)
      const config = (await response.json()) as PresentationConfig
      this.renderSlides(config)
    } catch (error) {
      console.error('Failed to load presentation config:', error)
    }
  }

  renderSlides(config: PresentationConfig): void {
    // Initialize the reveal container
    this.innerHTML = `
      <div class="reveal">
        <div class="slides"></div>
      </div>
    `

    this.createSlides(config)
    const selectedPlugins = (config.plugins || [])
      .map((name) => pluginMap[name])
      .filter(Boolean)

    // If Reveal is already initialized, destroy it first
    if (typeof Reveal.destroy === 'function') {
      Reveal.destroy()
    }

    Reveal.initialize({
      hash: true,
      ...config.revealOptions,
      plugins: selectedPlugins,
    })
  }

  private createSlides(config: PresentationConfig): void {
    const slidesContainer = this.querySelector('.reveal .slides')
    if (!slidesContainer) {
      console.error('Slides container not found')
      return
    }

    config.slides.forEach((slide) => {
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

      slidesContainer.appendChild(section)
    })
  }
}

customElements.define('magic-slider', MagicSlider)

export default MagicSlider
