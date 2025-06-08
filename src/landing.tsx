import './styles.css'
import MagicSlider from './components/MagicSlider'

interface PresentationConfig {
  revealOptions?: Record<string, unknown>
  plugins?: ('highlight' | 'notes')[]
  slides: {
    title?: string
    content?: string
    backgroundImage?: string
    attributes?: Record<string, string>
  }[]
}

class SliderGenerator {
  private input: HTMLInputElement | null = null
  private generateButton: HTMLButtonElement | null = null
  private loadingIndicator: HTMLDivElement | null = null
  private resultContainer: HTMLDivElement | null = null
  private errorContainer: HTMLDivElement | null = null
  private sliderContainer: HTMLDivElement | null = null

  constructor() {
    this.initUI()
    this.setupEventListeners()
  }

  private initUI(): void {
    const container = document.createElement('div')
    container.className = 'slider-generator'

    // Prompt input
    const inputContainer = document.createElement('div')
    inputContainer.className = 'input-container'

    const inputLabel = document.createElement('label')
    inputLabel.textContent = 'Describe your presentation:'
    inputLabel.htmlFor = 'prompt-input'

    const input = document.createElement('input')
    input.type = 'text'
    input.id = 'prompt-input'
    input.placeholder = 'E.g., "Create a 3-slide presentation about artificial intelligence"'
    this.input = input

    const generateButton = document.createElement('button')
    generateButton.textContent = 'Generate Slides'
    generateButton.className = 'generate-button'
    this.generateButton = generateButton

    inputContainer.appendChild(inputLabel)
    inputContainer.appendChild(input)
    inputContainer.appendChild(generateButton)

    // Loading indicator
    const loadingIndicator = document.createElement('div')
    loadingIndicator.className = 'loading-indicator hidden'
    loadingIndicator.textContent = 'Generating slides...'
    this.loadingIndicator = loadingIndicator

    // Error container
    const errorContainer = document.createElement('div')
    errorContainer.className = 'error-container hidden'
    this.errorContainer = errorContainer

    // Result container (JSON output)
    const resultContainer = document.createElement('pre')
    resultContainer.className = 'result-container hidden'
    this.resultContainer = resultContainer

    // Slider container
    const sliderContainer = document.createElement('div')
    sliderContainer.className = 'slider-container hidden'
    this.sliderContainer = sliderContainer

    // Append all elements to the container
    container.appendChild(inputContainer)
    container.appendChild(loadingIndicator)
    container.appendChild(errorContainer)
    container.appendChild(resultContainer)
    container.appendChild(sliderContainer)

    // Replace the existing content with our new UI
    const main = document.querySelector('main')
    if (main) {
      main.innerHTML = ''
      main.appendChild(container)
    }
  }

  private setupEventListeners(): void {
    // Generate slides when button is clicked
    if (this.generateButton && this.input) {
      this.generateButton.addEventListener('click', () => {
        this.generateSlides()
      })

      // Also generate slides when Enter is pressed in the input field
      this.input.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
          this.generateSlides()
        }
      })
    }
  }

  private async generateSlides(): Promise<void> {
    if (!this.input) {
      this.showError('Please enter a prompt.')
      return
    }

    const prompt = this.input.value.trim()
    if (!prompt) {
      this.showError('Please enter a prompt.')
      return
    }

    this.showLoading()

    try {
      const response = await this.fetchFromOpenAI(prompt)
      this.hideLoading()

      if (response) {
        this.renderSlides(response)
      }
    } catch (error) {
      this.hideLoading()
      this.showError(`Error: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  private async fetchFromOpenAI(prompt: string): Promise<PresentationConfig | null> {
    // API configuration
    const BASE_URL = 'https://magic.arz.ai/chat/openai/v1/completion'
    const API_KEY = 'None'
    const MODEL = 'agt-4a061995-772c-4241-bec9-0ce7d2f5897e'
    const requestBody = {
      model: MODEL,
      messages: [
        { role: "user", content: prompt }
      ],
      stream: true
    }

    const response = await fetch(BASE_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'API-Key': API_KEY
      },
      body: JSON.stringify(requestBody)
    })

    if (!response.ok) {
      const errorData = await response.json()
      throw new Error(errorData.error?.message || 'Failed to fetch from OpenAI')
    }

    if (!response.body) {
      throw new Error('Response body is null')
    }

    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let jsonString = ''

    if (this.resultContainer) {
      this.resultContainer.innerHTML = ''
      this.resultContainer.classList.remove('hidden')
    }

    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      const chunk = decoder.decode(value)
      const lines = chunk.split('\n')

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const data = line.slice(6)
          if (data === '[DONE]') continue

          try {
            const parsedData = JSON.parse(data)
            const content = parsedData.choices[0]?.delta?.content

            if (content) {
              jsonString += content
              if (this.resultContainer) {
                this.resultContainer.textContent = jsonString
              }
            }
          } catch (e) {
            // Ignore parsing errors for incomplete JSON
          }
        }
      }
    }

    try {
      // Clean up the JSON string (remove any non-JSON content)
      jsonString = jsonString.trim()
      if (jsonString.startsWith('```json')) {
        jsonString = jsonString.slice(7)
      }
      if (jsonString.endsWith('```')) {
        jsonString = jsonString.slice(0, -3)
      }

      const parsedJson = JSON.parse(jsonString.trim())
      return parsedJson as PresentationConfig
    } catch (error) {
      throw new Error(`Failed to parse JSON: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  private renderSlides(config: PresentationConfig): void {
    if (!config.slides || !Array.isArray(config.slides) || config.slides.length === 0) {
      this.showError('Invalid slides data received')
      return
    }
    if (!this.sliderContainer) return

    // Clear previous content
    this.sliderContainer.innerHTML = ''
    this.sliderContainer.classList.remove('hidden')

    // Create the magic-slider element
    const magicSlider = document.createElement('magic-slider')
    this.sliderContainer.appendChild(magicSlider)

    // Store the config in localStorage
    localStorage.setItem('generatedSlides', JSON.stringify(config))

    // Create a custom event to notify the MagicSlider component
    const event = new CustomEvent('slidesGenerated', { detail: config })
    magicSlider.dispatchEvent(event)

  }

  private showLoading(): void {
    if (this.loadingIndicator) {
      this.loadingIndicator.classList.remove('hidden')
    }
    if (this.errorContainer) {
      this.errorContainer.classList.add('hidden')
    }
    if (this.resultContainer) {
      this.resultContainer.classList.add('hidden')
    }
    if (this.generateButton) {
      this.generateButton.disabled = true
    }
    if (this.input) {
      this.input.disabled = true
    }
  }

  private hideLoading(): void {
    if (this.loadingIndicator) {
      this.loadingIndicator.classList.add('hidden')
    }
    if (this.generateButton) {
      this.generateButton.disabled = false
    }
    if (this.input) {
      this.input.disabled = false
    }
  }

  private showError(message: string): void {
    if (this.errorContainer) {
      this.errorContainer.textContent = message
      this.errorContainer.classList.remove('hidden')
    }
  }
}

// Initialize the application
document.addEventListener('DOMContentLoaded', () => {
  new SliderGenerator()
})
