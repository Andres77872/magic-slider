import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { Logger } from '../lib/logger'
import AppErrorBoundary from './AppErrorBoundary'

function createLogger(): Logger {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }
}

function ThrowingChild(): React.ReactElement {
  throw new Error('Controlled render failure')
}

describe('AppErrorBoundary', () => {
  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('shows a visible recovery fallback and logs render exceptions', () => {
    const log = createLogger()
    vi.spyOn(console, 'error').mockImplementation(() => undefined)

    render(
      <AppErrorBoundary onRetry={vi.fn()} onReload={vi.fn()} log={log}>
        <ThrowingChild />
      </AppErrorBoundary>,
    )

    expect(screen.getByRole('alert')).toHaveTextContent(/rendering problem/i)
    expect(screen.getByRole('button', { name: /retry render/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /reload app/i })).toBeInTheDocument()
    expect(log.error).toHaveBeenCalledWith(
      'Unhandled React render error reached AppErrorBoundary',
      expect.objectContaining({ componentStack: expect.any(String) }),
      expect.objectContaining({ message: 'Controlled render failure' }),
    )
  })

  it('retries by clearing fallback state and invoking the remount callback', () => {
    const onRetry = vi.fn()
    vi.spyOn(console, 'error').mockImplementation(() => undefined)

    render(
      <AppErrorBoundary onRetry={onRetry} onReload={vi.fn()} log={createLogger()}>
        <ThrowingChild />
      </AppErrorBoundary>,
    )

    fireEvent.click(screen.getByRole('button', { name: /retry render/i }))

    expect(onRetry).toHaveBeenCalledTimes(1)
  })

  it('offers a reload action without deleting saved history', () => {
    const onReload = vi.fn()
    const removeItem = vi.spyOn(window.localStorage.__proto__, 'removeItem')
    vi.spyOn(console, 'error').mockImplementation(() => undefined)

    render(
      <AppErrorBoundary onRetry={vi.fn()} onReload={onReload} log={createLogger()}>
        <ThrowingChild />
      </AppErrorBoundary>,
    )

    fireEvent.click(screen.getByRole('button', { name: /reload app/i }))

    expect(onReload).toHaveBeenCalledTimes(1)
    expect(removeItem).not.toHaveBeenCalled()
  })
})
