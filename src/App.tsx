import React, { useState } from 'react'
import Chatbot from './components/Chatbot'
import RevealSlider from './components/RevealSlider'
import type { PresentationConfig } from './types'

const App: React.FC = () => {
  const [config, setConfig] = useState<PresentationConfig | null>(null)

  return (
    <div className="app">
      <header>
        <h1>Magic Slider</h1>
        <p>Chat with the AI to generate Reveal.js slides.</p>
      </header>
      <Chatbot onGenerate={setConfig} />
      {config && <RevealSlider config={config} />}
    </div>
  )
}

export default App