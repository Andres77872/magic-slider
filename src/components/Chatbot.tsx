import React, { useState } from 'react'
import type { PresentationConfig } from '../types'

interface ChatbotProps {
  onGenerate: (config: PresentationConfig) => void
}

const Chatbot: React.FC<ChatbotProps> = ({ onGenerate }) => {
  const [prompt, setPrompt] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [resultJson, setResultJson] = useState('')

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
      setError('Please enter a prompt')
      return
    }
    setLoading(true)
    setError(null)
    setResultJson('')
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
    }
  }

  const handleKeyPress = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      handleGenerate()
    }
  }

  return (
    <div className="chatbot-container">
      <div className="input-group">
        <label htmlFor="prompt-input">Describe your presentation:</label>
        <input
          id="prompt-input"
          type="text"
          placeholder='E.g., "3-slide presentation about AI"'
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyPress={handleKeyPress}
          disabled={loading}
        />
      </div>
      <button onClick={handleGenerate} disabled={loading}>
        {loading ? 'Generating...' : 'Generate Slides'}
      </button>
      {error && <div className="error">{error}</div>}
      {resultJson && (
        <pre className="result-json">{resultJson}</pre>
      )}
    </div>
  )
}

export default Chatbot