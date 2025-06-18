import React, { useState } from 'react'
import type { PresentationConfig } from '../types'

interface ChatbotProps {
  onGenerate: (config: PresentationConfig) => void
  onGeneratingStateChange?: (generating: boolean) => void
}

const Chatbot: React.FC<ChatbotProps> = ({ onGenerate, onGeneratingStateChange }) => {
  const [prompt, setPrompt] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [resultJson, setResultJson] = useState('')
  const [showJson, setShowJson] = useState(false)

  const fetchSlides = async (userPrompt: string) => {
    const apiKey = 'NONE'
    if (!apiKey) {
      throw new Error('OpenAI API key is not configured')
    }
    const response = await fetch('https://magic.arz.ai/chat/openai/v1/completion', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'agt-4a061995-772c-4241-bec9-0ce7d2f5897e',
        messages: [{ role: 'user', content: userPrompt }],
        stream: true,
      }),
    })
    if (!response.ok) {
      const err = await response.json()
      throw new Error(err.error?.message || 'Error generating slides')
    }
    const reader = response.body!.getReader()
    const decoder = new TextDecoder()
    let jsonString = ''
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      const chunk = decoder.decode(value)
      const lines = chunk.split('\n')
      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const data = line.slice(6)
          if (data === '[DONE]') return jsonString
          try {
            const parsed = JSON.parse(data)
            const content = parsed.choices[0]?.delta?.content
            if (content) {
              jsonString += content
              setResultJson(jsonString)
            }
          } catch {}
        }
      }
    }
    return jsonString
  }

  const handleGenerate = async () => {
    if (!prompt.trim()) {
      setError('Please enter a prompt describing your presentation')
      return
    }
    setLoading(true)
    setError(null)
    setResultJson('')
    onGeneratingStateChange?.(true)
    
    try {
      const raw = await fetchSlides(prompt)
      let trimmed = raw.trim()
      if (trimmed.startsWith('```json')) trimmed = trimmed.slice(7)
      if (trimmed.endsWith('```')) trimmed = trimmed.slice(0, -3)
      const config = JSON.parse(trimmed)
      onGenerate(config)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
      onGeneratingStateChange?.(false)
    }
  }

  const handleKeyPress = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleGenerate()
    }
  }

  const examplePrompts = [
    "Create a 5-slide presentation about sustainable energy solutions",
    "Build a marketing pitch for a new mobile app",
    "Make slides about machine learning basics for beginners",
    "Create a quarterly business review presentation"
  ]

  return (
    <div className="chatbot-container">
      <div className="chatbot-form">
        <div className="input-group">
          <label htmlFor="prompt-input" className="input-label">
            What kind of presentation would you like to create?
          </label>
          <textarea
            id="prompt-input"
            className="form-control prompt-textarea"
            placeholder="Describe your presentation... (e.g., '5-slide pitch about renewable energy for investors')"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyPress={handleKeyPress}
            disabled={loading}
            rows={4}
          />
          <div className="input-help">
            <span>💡 Tip: Be specific about the topic, audience, and number of slides you want</span>
          </div>
        </div>

        <div className="action-group">
          <button 
            className="btn btn-primary btn-generate"
            onClick={handleGenerate} 
            disabled={loading || !prompt.trim()}
          >
            {loading ? (
              <>
                <div className="btn-spinner"></div>
                Generating...
              </>
            ) : (
              <>
                <span className="btn-icon">✨</span>
                Generate Slides
              </>
            )}
          </button>
        </div>

        {error && (
          <div className="alert alert-error">
            <span className="alert-icon">⚠️</span>
            <span>{error}</span>
          </div>
        )}

        {resultJson && (
          <div className="result-section">
            <div className="result-header">
              <h4>Generation Progress</h4>
              <button 
                className="btn btn-sm btn-outline"
                onClick={() => setShowJson(!showJson)}
              >
                {showJson ? 'Hide' : 'Show'} JSON
              </button>
            </div>
            {showJson && (
              <pre className="result-json">{resultJson}</pre>
            )}
          </div>
        )}
      </div>

      {/* Example Prompts */}
      <div className="examples-section">
        <h4 className="examples-title">Try these examples:</h4>
        <div className="examples-grid">
          {examplePrompts.map((example, index) => (
            <button
              key={index}
              className="example-prompt"
              onClick={() => setPrompt(example)}
              disabled={loading}
            >
              {example}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

export default Chatbot