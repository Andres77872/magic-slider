import type { PersistenceFailureKind, PersistenceStatus } from '../session/useLocalSessions'

interface PersistenceNoticeProps {
  status?: PersistenceStatus
  error?: string | null
  failureKind?: PersistenceFailureKind | null
  busy?: boolean
  onRetry?: () => void
  onContinueFresh?: () => void
  onClear?: () => void
}

export default function PersistenceNotice({ status, error, failureKind, busy, onRetry, onContinueFresh, onClear }: PersistenceNoticeProps) {
  if (!error && status !== 'failed' && status !== 'recovered') return null
  const failed = status === 'failed'
  const unsaved = failed && failureKind === 'write'
  return (
    <div className={`workspace-status workspace-status--${failed ? 'error' : 'recovered'}`} role={error || failed ? 'alert' : 'status'}>
      <strong>{unsaved ? 'Changes aren’t saved yet.' : failed ? 'Local history needs recovery.' : 'Local history notice.'}</strong>{' '}
      <span>{error ?? 'Your available history was recovered. Review recent sessions before continuing.'}</span>
      {unsaved && <span> Keep this tab open and retry saving, or export your deck before leaving.</span>}
      {failed && (
        <div className="workspace-status__actions">
          <button type="button" className="btn btn-secondary btn-sm" disabled={busy} onClick={onRetry}>{unsaved ? 'Retry save' : 'Retry'}</button>
          {!unsaved && <>
            <button type="button" className="btn btn-secondary btn-sm" disabled={busy} onClick={onContinueFresh}>Continue Fresh</button>
            <button type="button" className="btn btn-secondary btn-sm" disabled={busy} onClick={onClear}>Clear History</button>
          </>}
        </div>
      )}
    </div>
  )
}
