import React, { useState } from 'react'
import Chatbot from './components/Chatbot'
import RevealSlider from './components/RevealSlider'
import type { PresentationConfig } from './types'

const App: React.FC = () => {
  const [config, setConfig] = useState<PresentationConfig | null>(null)
  const [isGenerating, setIsGenerating] = useState(false)

  const handleGenerate = (newConfig: PresentationConfig) => {
    setConfig(newConfig)
    setIsGenerating(false)
  }

  const handleGeneratingStateChange = (generating: boolean) => {
    setIsGenerating(generating)
  }

  return (
    <div className="app">
      {!config ? (
        <div className="app-home">
          {/* Hero Section */}
          <section className="hero">
            <div className="container">
              <div className="hero-content">
                <h1 className="hero-title">
                  Magic Slider
                  <span className="hero-subtitle">AI-Powered Presentation Builder</span>
                </h1>
                <p className="hero-description">
                  Transform your ideas into stunning presentations in seconds. 
                  Just describe what you want, and watch the magic happen.
                </p>
                <div className="hero-features">
                  <div className="feature">
                    <div className="feature-icon">🚀</div>
                    <span>Instant Generation</span>
                  </div>
                  <div className="feature">
                    <div className="feature-icon">🎨</div>
                    <span>Beautiful Designs</span>
                  </div>
                  <div className="feature">
                    <div className="feature-icon">⚡</div>
                    <span>AI-Powered</span>
                  </div>
                </div>
              </div>
            </div>
          </section>

          {/* Chat Section */}
          <section className="chat-section">
            <div className="container">
              <div className="chat-wrapper">
                <h2 className="section-title">Create Your Presentation</h2>
                <p className="section-subtitle">
                  Describe your presentation topic, audience, and any specific requirements
                </p>
                <Chatbot 
                  onGenerate={handleGenerate} 
                  onGeneratingStateChange={handleGeneratingStateChange}
                />
              </div>
            </div>
          </section>
        </div>
      ) : (
        <div className="app-presentation">
          {/* Presentation Header */}
          <header className="presentation-header">
            <div className="container">
              <div className="header-content">
                <h1 className="presentation-title">Your Presentation</h1>
                <button 
                  className="btn btn-secondary"
                  onClick={() => setConfig(null)}
                >
                  ← Create New
                </button>
              </div>
            </div>
          </header>

          {/* Presentation Content */}
          <main className="presentation-main">
            <RevealSlider config={config} />
          </main>
        </div>
      )}

      {/* Loading Overlay */}
      {isGenerating && (
        <div className="loading-overlay">
          <div className="loading-content">
            <div className="loading-spinner"></div>
            <h3>Creating your presentation...</h3>
            <p>This might take a few moments</p>
          </div>
        </div>
      )}
    </div>
  )
}

export default App