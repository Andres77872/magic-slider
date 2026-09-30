import { useEffect, useRef } from 'react'

import Icon from './Icon'

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)
export const MOD = isMac ? '⌘' : 'Ctrl'

export const shortcutGroups: Array<{ title: string; items: Array<[string, string]> }> = [
  {
    title: 'Editing',
    items: [
      [`${MOD}+Z`, 'Undo'],
      [`${MOD}+Shift+Z`, 'Redo'],
      ['Enter / double-click', 'Edit text in place'],
      [`${MOD}+B / I / E / K`, 'Bold, italic, accent, link (while editing text)'],
      ['Delete', 'Delete the selection'],
      [`${MOD}+D`, 'Duplicate'],
      [`${MOD}+C / X / V`, 'Copy, cut, paste'],
      ['Alt+↑ / Alt+↓', 'Move up or down'],
      ['/', 'Insert a block'],
      [`${MOD}+M`, 'New slide'],
    ],
  },
  {
    title: 'Selection and slides',
    items: [
      ['Click', 'Select an element'],
      ['Esc / Shift+Enter', 'Select the parent, then the slide'],
      ['Tab (canvas)', 'Next element'],
      ['← / →', 'Previous or next slide'],
      ['Alt+← / Alt+→ (filmstrip)', 'Move the slide'],
      ['Shift+F10 (filmstrip)', 'Slide menu'],
    ],
  },
  {
    title: 'Chat and view',
    items: [
      [`@ or ${MOD}+J`, 'Reference the selection in chat'],
      ['@ in the message box', 'Mention a slide or element'],
      ['Enter', 'Send the message'],
      [`P or ${MOD}+Enter`, 'Present from the current slide'],
      ['?', 'Show these shortcuts'],
    ],
  },
]

export default function ShortcutsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const dialog = ref.current
    if (!dialog) return
    if (open && !dialog.open) {
      if (typeof dialog.showModal === 'function') dialog.showModal()
      else dialog.setAttribute('open', '')
    } else if (!open && dialog.open) {
      if (typeof dialog.close === 'function') dialog.close()
      else dialog.removeAttribute('open')
    }
  }, [open])
  return (
    <dialog
      ref={ref}
      className="v2-dialog"
      aria-labelledby="v2-shortcuts-title"
      onClose={onClose}
      onCancel={(event) => { event.preventDefault(); onClose() }}
      onClick={(event) => { if (event.target === event.currentTarget) onClose() }}
    >
      <header className="v2-dialog__header">
        <h2 id="v2-shortcuts-title"><Icon name="keyboard" /> Keyboard shortcuts</h2>
        <button type="button" className="v2-icon-button" aria-label="Close" onClick={onClose}><Icon name="x" /></button>
      </header>
      <div className="v2-shortcuts">
        {shortcutGroups.map((group) => (
          <section key={group.title}>
            <h3>{group.title}</h3>
            <dl>
              {group.items.map(([keys, action]) => (
                <div key={keys} className="v2-shortcuts__row"><dt><kbd>{keys}</kbd></dt><dd>{action}</dd></div>
              ))}
            </dl>
          </section>
        ))}
      </div>
    </dialog>
  )
}
