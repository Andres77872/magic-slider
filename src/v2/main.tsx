import React from 'react'
import ReactDOM from 'react-dom/client'

import AppErrorBoundary from '../components/AppErrorBoundary'
import StudioApp from './ui/StudioApp'
// Reveal core first, then the primitive stylesheet, then the studio chrome.
import 'reveal.js/reveal.css'
import './styles/deck.css'
import './styles/studio.css'

const Root = () => {
  const [key, setKey] = React.useState(0)
  return (
    <AppErrorBoundary onRetry={() => setKey((value) => value + 1)} onReload={() => window.location.reload()}>
      <StudioApp key={key} />
    </AppErrorBoundary>
  )
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>,
)
