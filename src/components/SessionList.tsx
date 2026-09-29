import { useEffect, useRef, useState } from 'react'

import { isSafeImageUrl } from '../presentation/imageUrl'
import type { LocalSessionSummary } from '../session/localSessionModel'

interface SessionListProps {
  variant: 'home' | 'workspace'
  sessions: LocalSessionSummary[]
  selectedSessionId?: string
  disabled?: boolean
  clearDisabled?: boolean
  onSelect?: (sessionId: string) => void
  onClear?: () => void
}

const relativeTime = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' })

export function describeUpdatedAt(updatedAt: string, now = Date.now()): string {
  const time = Date.parse(updatedAt)
  if (Number.isNaN(time)) return ''
  const minutes = Math.round((time - now) / 60_000)
  if (Math.abs(minutes) < 1) return 'just now'
  if (Math.abs(minutes) < 60) return relativeTime.format(minutes, 'minute')
  const hours = Math.round(minutes / 60)
  if (Math.abs(hours) < 24) return relativeTime.format(hours, 'hour')
  return relativeTime.format(Math.round(hours / 24), 'day')
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`
}

export default function SessionList({ variant, sessions, selectedSessionId, disabled, clearDisabled, onSelect, onClear }: SessionListProps) {
  const [confirmingClear, setConfirmingClear] = useState(false)
  const confirmRef = useRef<HTMLButtonElement>(null)
  const clearRef = useRef<HTMLButtonElement>(null)
  const returnFocusRef = useRef(false)

  useEffect(() => {
    if (confirmingClear) {
      confirmRef.current?.focus()
    } else if (returnFocusRef.current) {
      returnFocusRef.current = false
      clearRef.current?.focus()
    }
  }, [confirmingClear])

  useEffect(() => {
    if (sessions.length === 0 || clearDisabled) setConfirmingClear(false)
  }, [sessions.length, clearDisabled])

  const clearControls = confirmingClear ? (
    <div className="session-clear-confirm" role="group" aria-label="Confirm clearing history">
      <span>Delete every saved presentation in this browser?</span>
      <button
        ref={confirmRef}
        type="button"
        className="btn btn-danger btn-sm"
        data-testid="confirm-clear-history"
        onClick={() => {
          setConfirmingClear(false)
          onClear?.()
        }}
      >
        Delete all
      </button>
      <button
        type="button"
        className="btn btn-ghost btn-sm"
        onClick={() => {
          returnFocusRef.current = true
          setConfirmingClear(false)
        }}
      >
        Cancel
      </button>
    </div>
  ) : (
    <button
      ref={clearRef}
      type="button"
      className="btn btn-ghost btn-sm"
      data-testid="clear-history-button"
      onClick={() => setConfirmingClear(true)}
      disabled={sessions.length === 0 || clearDisabled}
    >
      Clear History
    </button>
  )

  return (
    <div className={`session-list session-list--${variant}`} data-testid="recent-sessions">
      <div className="session-list__header">
        <div>
          <p className="eyebrow">{variant === 'home' ? 'Pick up where you left off' : 'Recent sessions'}</p>
          <h3 className="session-list__title">{variant === 'home' ? 'Recent Sessions' : 'Your presentations'}</h3>
        </div>
        {clearControls}
      </div>
      {sessions.length === 0 ? (
        <p className="session-list__empty">No recent sessions available.</p>
      ) : (
        <div className="session-list__items">
          {sessions.map((session) => {
            const cover = session.coverImage && isSafeImageUrl(session.coverImage) ? session.coverImage : undefined
            const updated = describeUpdatedAt(session.updatedAt)
            return (
              <button
                key={session.id}
                type="button"
                className={`session-card theme-swatch--${session.theme ?? 'midnight'}`}
                aria-current={session.id === selectedSessionId ? 'true' : undefined}
                onClick={() => onSelect?.(session.id)}
                disabled={disabled}
              >
                <span className="session-card__cover" aria-hidden="true">
                  {cover && <img src={cover} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" />}
                </span>
                <span className="session-card__body">
                  <span className="session-card__title">{session.title}</span>
                  <small>
                    {plural(session.slideCount, 'slide')} · {plural(session.messageCount, 'message')}
                    {updated && <> · {updated}</>}
                  </small>
                </span>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
