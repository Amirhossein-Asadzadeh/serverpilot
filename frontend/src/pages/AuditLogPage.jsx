/**
 * AuditLogPage — Paginated table of all actions performed through the panel.
 *
 * Each row shows: timestamp, user, server, action type, details.
 * Color-coded by action type for quick scanning.
 */

import { useEffect, useState } from 'react'
import { ChevronLeft, ChevronRight, ClipboardList, RefreshCw } from 'lucide-react'
import { TableRowSkeleton } from '../components/LoadingSkeleton'
import api from '../api/api'
import toast from 'react-hot-toast'

const ACTION_COLORS = {
  reboot: '#ff4444',
  exec: '#00d4ff',
  schedule_add: '#00ff88',
  schedule_delete: '#ffd700',
  server_add: '#a855f7',
  server_update: '#a855f7',
  server_delete: '#ff4444',
  login: '#94a3b8',
}

const ACTION_LABELS = {
  reboot: 'REBOOT',
  exec: 'EXEC',
  schedule_add: 'SCHEDULE+',
  schedule_delete: 'SCHEDULE-',
  server_add: 'SERVER+',
  server_update: 'SERVER~',
  server_delete: 'SERVER-',
  login: 'LOGIN',
}

function ActionBadge({ action }) {
  const color = ACTION_COLORS[action] || '#94a3b8'
  return (
    <span
      className="px-2 py-0.5 rounded text-xs font-mono font-semibold"
      style={{
        background: `${color}18`,
        border: `1px solid ${color}33`,
        color,
      }}
    >
      {ACTION_LABELS[action] || action}
    </span>
  )
}

export default function AuditLogPage() {
  const [logs, setLogs] = useState([])
  const [loading, setLoading] = useState(true)
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const [total, setTotal] = useState(0)
  const PER_PAGE = 50

  const fetchLogs = async (p = page) => {
    setLoading(true)
    try {
      const resp = await api.get(`/audit?page=${p}&per_page=${PER_PAGE}`)
      setLogs(resp.data.items)
      setTotalPages(resp.data.pages)
      setTotal(resp.data.total)
    } catch {
      toast.error('Failed to load audit log')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchLogs(page)
  }, [page])

  return (
    <div className="p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="section-title flex items-center gap-2">
            <ClipboardList size={18} />
            Audit Log
          </h1>
          <p className="text-text-muted text-sm font-mono mt-1">
            {total} total records
          </p>
        </div>
        <button
          onClick={() => fetchLogs(page)}
          className="p-2 rounded-lg hover:bg-bg-elevated transition-colors text-text-muted hover:text-text-primary"
        >
          <RefreshCw size={16} />
        </button>
      </div>

      {/* Table */}
      <div className="glass-card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr style={{ borderBottom: '1px solid #1e2d45' }}>
                {['Timestamp', 'User', 'Server', 'Action', 'Detail'].map((h) => (
                  <th
                    key={h}
                    className="px-4 py-3 text-left text-xs font-mono uppercase tracking-widest text-text-muted"
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading
                ? Array.from({ length: 10 }).map((_, i) => (
                    <TableRowSkeleton key={i} cols={5} />
                  ))
                : logs.map((log) => (
                    <tr
                      key={log.id}
                      className="border-b border-border/50 hover:bg-bg-elevated transition-colors"
                    >
                      <td className="px-4 py-3 text-text-muted text-xs font-mono whitespace-nowrap">
                        {log.timestamp
                          ? new Date(log.timestamp).toLocaleString()
                          : '—'}
                      </td>
                      <td className="px-4 py-3 text-text-primary text-xs font-mono">
                        {log.username || '—'}
                      </td>
                      <td className="px-4 py-3 text-accent-cyan text-xs font-mono">
                        {log.server_name || '—'}
                      </td>
                      <td className="px-4 py-3">
                        <ActionBadge action={log.action} />
                      </td>
                      <td className="px-4 py-3 text-text-secondary text-xs font-mono max-w-xs truncate">
                        {log.detail || '—'}
                      </td>
                    </tr>
                  ))}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-border">
            <p className="text-text-muted text-xs font-mono">
              Page {page} of {totalPages}
            </p>
            <div className="flex gap-2">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page <= 1}
                className="p-1.5 rounded hover:bg-bg-elevated disabled:opacity-30 disabled:cursor-not-allowed text-text-muted hover:text-text-primary transition-colors"
              >
                <ChevronLeft size={16} />
              </button>
              <button
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page >= totalPages}
                className="p-1.5 rounded hover:bg-bg-elevated disabled:opacity-30 disabled:cursor-not-allowed text-text-muted hover:text-text-primary transition-colors"
              >
                <ChevronRight size={16} />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
