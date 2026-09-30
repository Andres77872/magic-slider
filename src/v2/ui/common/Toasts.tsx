import { useCallback, useEffect, useRef, useState } from 'react'

import Icon from './Icon'

export interface Toast {
  id: number
  kind: 'success' | 'error' | 'info'
  text: string
  action?: { label: string; onClick: () => void }
}

export type PushToast = (toast: Omit<Toast, 'id'>) => void

/** Transient, non-blocking notices. Errors stay until dismissed; others fade after a few seconds. */
export function useToasts() {
  const [toasts, setToasts] = useState<Toast[]>([])
  const counter = useRef(0)
  const dismiss = useCallback((id: number) => setToasts((current) => current.filter((toast) => toast.id !== id)), [])
  const push = useCallback<PushToast>((toast) => {
    counter.current += 1
    const id = counter.current
    setToasts((current) => [...current.slice(-3), { ...toast, id }])
  }, [])
  return { toasts, push, dismiss }
}

function ToastItem({ toast, onDismiss }: { toast: Toast; onDismiss: (id: number) => void }) {
  useEffect(() => {
    if (toast.kind === 'error') return undefined
    const timer = window.setTimeout(() => onDismiss(toast.id), toast.action ? 8_000 : 5_000)
    return () => window.clearTimeout(timer)
  }, [toast, onDismiss])
  return (
    <div className={`v2-toast v2-toast--${toast.kind}`} role={toast.kind === 'error' ? 'alert' : 'status'}>
      <Icon name={toast.kind === 'error' ? 'warning' : toast.kind === 'success' ? 'check' : 'sparkles'} />
      <span className="v2-toast__text">{toast.text}</span>
      {toast.action && (
        <button type="button" className="v2-toast__action" onClick={() => { toast.action!.onClick(); onDismiss(toast.id) }}>{toast.action.label}</button>
      )}
      <button type="button" className="v2-toast__close" aria-label="Dismiss" onClick={() => onDismiss(toast.id)}><Icon name="x" size={14} /></button>
    </div>
  )
}

export function ToastRegion({ toasts, onDismiss }: { toasts: Toast[]; onDismiss: (id: number) => void }) {
  return (
    <div className="v2-toasts" aria-live="polite">
      {toasts.map((toast) => <ToastItem key={toast.id} toast={toast} onDismiss={onDismiss} />)}
    </div>
  )
}
