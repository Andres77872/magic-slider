import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import AppErrorBoundary from './components/AppErrorBoundary'
// Reveal's core styles load first so the slide themes in styles.css override them, as in exports.
import 'reveal.js/reveal.css'
import './styles.css'

const RootApp = () => {
  const [appKey, setAppKey] = React.useState(0)
  const remountApp = () => setAppKey((key) => key + 1)

  return (
    <AppErrorBoundary onRetry={remountApp} onReload={() => window.location.reload()}>
      <App key={appKey} />
    </AppErrorBoundary>
  )
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <RootApp />
  </React.StrictMode>
)
