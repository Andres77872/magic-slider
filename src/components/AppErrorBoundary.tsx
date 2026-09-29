import React, { type ErrorInfo, type ReactNode } from 'react'

import { logger, type Logger } from '../lib/logger'

interface AppErrorBoundaryProps {
  children: ReactNode
  onRetry: () => void
  onReload: () => void
  log?: Logger
}

interface AppErrorBoundaryState {
  error: Error | null
  componentStack: string | null
}

class AppErrorBoundary extends React.Component<AppErrorBoundaryProps, AppErrorBoundaryState> {
  state: AppErrorBoundaryState = {
    error: null,
    componentStack: null,
  }

  static getDerivedStateFromError(error: Error): Partial<AppErrorBoundaryState> {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    this.setState({ componentStack: info.componentStack ?? null })
    ;(this.props.log ?? logger).error('Unhandled React render error reached AppErrorBoundary', {
      componentStack: info.componentStack,
    }, error)
  }

  private handleRetry = () => {
    this.setState({ error: null, componentStack: null })
    this.props.onRetry()
  }

  private handleReload = () => {
    this.setState({ error: null, componentStack: null })
    this.props.onReload()
  }

  render(): ReactNode {
    const { error, componentStack } = this.state
    if (!error) return this.props.children

    return (
      <main className="app-error-boundary" role="alert" aria-live="assertive">
        <section className="app-error-boundary__panel" aria-labelledby="app-error-boundary-title">
          <p className="app-error-boundary__eyebrow">Let’s get you back to your slides</p>
          <h1 id="app-error-boundary-title">Magic Slider hit a rendering problem</h1>
          <p className="app-error-boundary__copy">
            Try opening the presentation again. If that doesn’t help, reload the app to restore your saved session. Any unsaved changes may be lost.
          </p>
          <div className="app-error-boundary__actions">
            <button type="button" className="btn btn-primary" onClick={this.handleRetry}>
              Retry render
            </button>
            <button type="button" className="btn btn-secondary" onClick={this.handleReload}>
              Reload app
            </button>
          </div>
          <details className="app-error-boundary__details">
            <summary>Developer diagnostics</summary>
            <pre>{error.message}{componentStack ? `\n\n${componentStack}` : ''}</pre>
          </details>
        </section>
      </main>
    )
  }
}

export default AppErrorBoundary
