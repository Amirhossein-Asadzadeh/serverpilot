/**
 * ConfirmModal — Reusable confirmation dialog for destructive actions.
 * Appears centered over the page with a dark overlay.
 */

import { AlertTriangle } from 'lucide-react'

export default function ConfirmModal({ isOpen, title, message, onConfirm, onCancel, danger = true }) {
  if (!isOpen) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(4px)' }}
      onClick={onCancel}
    >
      <div
        className="glass-card p-6 w-full max-w-sm mx-4 animate-fade-in"
        onClick={(e) => e.stopPropagation()}
        style={{ border: danger ? '1px solid #ff444433' : '1px solid #1e2d45' }}
      >
        <div className="flex items-center gap-3 mb-4">
          <div
            className="w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0"
            style={{ background: '#ff444422', border: '1px solid #ff444433' }}
          >
            <AlertTriangle size={20} className="text-accent-red" />
          </div>
          <div>
            <h3 className="font-heading font-semibold text-text-primary">{title}</h3>
            <p className="text-text-muted text-sm mt-0.5">{message}</p>
          </div>
        </div>

        <div className="flex gap-3 justify-end">
          <button
            onClick={onCancel}
            className="px-4 py-2 rounded-lg text-sm font-medium text-text-secondary hover:text-text-primary border border-border hover:border-text-muted transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            className={danger ? 'btn-danger' : 'btn-primary'}
          >
            Confirm
          </button>
        </div>
      </div>
    </div>
  )
}
