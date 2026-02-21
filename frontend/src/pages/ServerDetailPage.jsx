/**
 * ServerDetailPage — Full server detail with real-time charts, command runner,
 * scheduled tasks management, and reboot control.
 *
 * Metrics history: maintains a rolling 60-point buffer updated from WebSocket.
 * Command runner: sends POST /servers/:id/exec and displays output in terminal.
 * Schedules: lists, adds, and removes cron jobs via agent proxy API.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import {
  ArrowLeft,
  Calendar,
  Clock,
  Cpu,
  HardDrive,
  MonitorCheck,
  Network,
  Play,
  Plus,
  Power,
  Server,
  Terminal,
  Trash2,
} from 'lucide-react'
import toast from 'react-hot-toast'
import MetricChart from '../components/MetricChart'
import ConfirmModal from '../components/ConfirmModal'
import { ChartSkeleton } from '../components/LoadingSkeleton'
import { useWebSocket } from '../hooks/useWebSocket'
import api from '../api/api'

const MAX_HISTORY = 60

function formatUptime(seconds) {
  if (!seconds) return '—'
  const d = Math.floor(seconds / 86400)
  const h = Math.floor((seconds % 86400) / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = seconds % 60
  if (d > 0) return `${d}d ${h}h ${m}m`
  if (h > 0) return `${h}h ${m}m ${s}s`
  return `${m}m ${s}s`
}

function formatBytes(bytes) {
  if (!bytes) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let i = 0
  let val = bytes
  while (val >= 1024 && i < units.length - 1) {
    val /= 1024
    i++
  }
  return `${val.toFixed(1)} ${units[i]}`
}

// ─── Scheduled Tasks Panel ────────────────────────────────────────────────────

function SchedulePanel({ serverId }) {
  const [jobs, setJobs] = useState([])
  const [loading, setLoading] = useState(true)
  const [form, setForm] = useState({ job_id: '', command: '', cron: '', label: '' })
  const [adding, setAdding] = useState(false)
  const [showForm, setShowForm] = useState(false)

  const fetchJobs = useCallback(async () => {
    try {
      const resp = await api.get(`/servers/${serverId}/schedule`)
      setJobs(resp.data.jobs || [])
    } catch {
      setJobs([])
    } finally {
      setLoading(false)
    }
  }, [serverId])

  useEffect(() => {
    fetchJobs()
  }, [fetchJobs])

  const handleAdd = async (e) => {
    e.preventDefault()
    if (!form.job_id || !form.command || !form.cron || !form.label) {
      toast.error('All fields required')
      return
    }
    setAdding(true)
    try {
      await api.post(`/servers/${serverId}/schedule`, form)
      toast.success('Job scheduled')
      setForm({ job_id: '', command: '', cron: '', label: '' })
      setShowForm(false)
      fetchJobs()
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Failed to schedule job')
    } finally {
      setAdding(false)
    }
  }

  const handleDelete = async (jobId) => {
    try {
      await api.delete(`/servers/${serverId}/schedule/${jobId}`)
      toast.success('Job removed')
      fetchJobs()
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Failed to remove job')
    }
  }

  return (
    <div className="glass-card p-5">
      <div className="flex items-center justify-between mb-4">
        <h3 className="section-title flex items-center gap-2 text-sm">
          <Calendar size={14} />
          Scheduled Tasks
        </h3>
        <button
          onClick={() => setShowForm(!showForm)}
          className="btn-primary flex items-center gap-1.5 text-xs py-1.5 px-3"
        >
          <Plus size={12} />
          Add Job
        </button>
      </div>

      {/* Add job form */}
      {showForm && (
        <form onSubmit={handleAdd} className="mb-4 p-4 rounded-lg space-y-3"
          style={{ background: '#0a0e1a', border: '1px solid #1e2d45' }}>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-mono text-text-muted mb-1">Job ID</label>
              <input className="input-field" placeholder="cleanup-logs"
                value={form.job_id} onChange={e => setForm({ ...form, job_id: e.target.value })} />
            </div>
            <div>
              <label className="block text-xs font-mono text-text-muted mb-1">Label</label>
              <input className="input-field" placeholder="Clean old logs"
                value={form.label} onChange={e => setForm({ ...form, label: e.target.value })} />
            </div>
          </div>
          <div>
            <label className="block text-xs font-mono text-text-muted mb-1">Command</label>
            <input className="input-field" placeholder="find /var/log -name '*.log' -mtime +30 -delete"
              value={form.command} onChange={e => setForm({ ...form, command: e.target.value })} />
          </div>
          <div>
            <label className="block text-xs font-mono text-text-muted mb-1">
              Cron Expression <span className="text-text-muted">e.g. "0 3 * * *" = daily at 3am</span>
            </label>
            <input className="input-field" placeholder="*/5 * * * *"
              value={form.cron} onChange={e => setForm({ ...form, cron: e.target.value })} />
          </div>
          <div className="flex gap-2">
            <button type="submit" disabled={adding} className="btn-primary text-xs">
              {adding ? 'Scheduling...' : 'Schedule'}
            </button>
            <button type="button" onClick={() => setShowForm(false)}
              className="px-3 py-1.5 text-xs text-text-muted hover:text-text-primary border border-border rounded-lg">
              Cancel
            </button>
          </div>
        </form>
      )}

      {/* Jobs list */}
      {loading ? (
        <div className="text-text-muted text-xs font-mono">Loading jobs...</div>
      ) : jobs.length === 0 ? (
        <div className="text-text-muted text-xs font-mono text-center py-4">
          No scheduled jobs. Add one above.
        </div>
      ) : (
        <div className="space-y-2">
          {jobs.map((job) => (
            <div key={job.job_id}
              className="flex items-center justify-between p-3 rounded-lg"
              style={{ background: '#0a0e1a', border: '1px solid #1e2d45' }}>
              <div className="flex-1 min-w-0">
                <div className="text-text-primary text-sm font-medium truncate">{job.label}</div>
                <div className="text-text-muted text-xs font-mono truncate">{job.trigger}</div>
                {job.next_run_time && (
                  <div className="text-accent-cyan text-xs font-mono mt-0.5">
                    Next: {new Date(job.next_run_time).toLocaleString()}
                  </div>
                )}
              </div>
              <button onClick={() => handleDelete(job.job_id)}
                className="ml-3 p-1.5 rounded hover:bg-red-500/10 text-text-muted hover:text-accent-red transition-colors">
                <Trash2 size={14} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function ServerDetailPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [server, setServer] = useState(null)
  const [metrics, setMetrics] = useState(null)
  const [history, setHistory] = useState([]) // rolling 60-point metric history
  const [command, setCommand] = useState('')
  const [output, setOutput] = useState(null)
  const [running, setRunning] = useState(false)
  const [showRebootModal, setShowRebootModal] = useState(false)
  const [loading, setLoading] = useState(true)
  const terminalRef = useRef(null)
  const { data: wsData } = useWebSocket()
  const prevNetRef = useRef(null)

  // Fetch server info
  useEffect(() => {
    api.get(`/servers/${id}`)
      .then((r) => setServer(r.data))
      .catch(() => toast.error('Server not found'))
      .finally(() => setLoading(false))
  }, [id])

  // Pull metrics for this server from WebSocket broadcast
  useEffect(() => {
    if (!wsData?.servers) return
    const m = wsData.servers.find((s) => s.server_id === parseInt(id))
    if (!m) return

    setMetrics(m)

    // Calculate network rate (bytes/s) from cumulative bytes
    const now = new Date()
    const timeLabel = now.toLocaleTimeString('en-US', { hour12: false })

    let netSent = 0
    let netRecv = 0
    if (prevNetRef.current) {
      const elapsed = (now - prevNetRef.current.time) / 1000
      if (elapsed > 0) {
        netSent = Math.max(0, (m.net_bytes_sent - prevNetRef.current.sent) / elapsed / 1024) // KB/s
        netRecv = Math.max(0, (m.net_bytes_recv - prevNetRef.current.recv) / elapsed / 1024) // KB/s
      }
    }
    prevNetRef.current = { time: now, sent: m.net_bytes_sent, recv: m.net_bytes_recv }

    const point = {
      time: timeLabel,
      cpu: m.cpu_percent,
      ram: m.ram_percent,
      disk: m.disk_percent,
      net_out: parseFloat(netSent.toFixed(2)),
      net_in: parseFloat(netRecv.toFixed(2)),
    }

    setHistory((prev) => {
      const next = [...prev, point]
      return next.slice(-MAX_HISTORY)
    })
  }, [wsData, id])

  // Auto-scroll terminal output
  useEffect(() => {
    if (terminalRef.current) {
      terminalRef.current.scrollTop = terminalRef.current.scrollHeight
    }
  }, [output])

  const handleRunCommand = async () => {
    if (!command.trim()) return
    setRunning(true)
    setOutput(null)
    try {
      const resp = await api.post(`/servers/${id}/exec`, { command, timeout: 30 })
      setOutput(resp.data)
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Command failed')
    } finally {
      setRunning(false)
    }
  }

  const handleReboot = async () => {
    setShowRebootModal(false)
    try {
      await api.post(`/servers/${id}/reboot`)
      toast.success('Reboot initiated — server will restart shortly')
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Reboot failed')
    }
  }

  if (loading) {
    return (
      <div className="p-6 grid grid-cols-2 gap-4">
        {Array.from({ length: 4 }).map((_, i) => <ChartSkeleton key={i} />)}
      </div>
    )
  }

  if (!server) {
    return (
      <div className="p-6 text-center text-text-muted font-mono">
        Server not found.
      </div>
    )
  }

  const isOnline = metrics?.is_online ?? server.is_online

  return (
    <div className="p-6 space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button onClick={() => navigate(-1)}
            className="p-2 rounded-lg hover:bg-bg-elevated transition-colors text-text-muted hover:text-text-primary">
            <ArrowLeft size={18} />
          </button>
          <div>
            <div className="flex items-center gap-2">
              <span className={`status-dot ${isOnline ? 'online' : 'offline'}`} />
              <h1 className="font-heading font-bold text-xl text-text-primary">
                {server.name}
              </h1>
            </div>
            <p className="text-text-muted text-sm font-mono">
              {server.ip}:{server.port}
              {metrics?.hostname && ` — ${metrics.hostname}`}
            </p>
          </div>
        </div>

        <button
          onClick={() => setShowRebootModal(true)}
          className="btn-danger flex items-center gap-2"
        >
          <Power size={14} />
          Reboot
        </button>
      </div>

      {/* System info bar */}
      {metrics && isOnline && (
        <div className="glass-card p-4 grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm font-mono">
          <div>
            <div className="text-text-muted text-xs uppercase tracking-wider mb-1">OS</div>
            <div className="text-text-primary truncate">{metrics.os || '—'}</div>
          </div>
          <div>
            <div className="text-text-muted text-xs uppercase tracking-wider mb-1">CPU Cores</div>
            <div className="text-text-primary">{metrics.cpu_count || '—'}</div>
          </div>
          <div>
            <div className="text-text-muted text-xs uppercase tracking-wider mb-1">Load Avg</div>
            <div className="text-text-primary">
              {metrics.load_avg?.map((v) => v.toFixed(2)).join(' / ') || '—'}
            </div>
          </div>
          <div>
            <div className="text-text-muted text-xs uppercase tracking-wider mb-1">Uptime</div>
            <div className="text-accent-green">{formatUptime(metrics.uptime_seconds)}</div>
          </div>
        </div>
      )}

      {/* Charts */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <MetricChart data={history} dataKey="cpu" label="CPU Usage" unit="%" color="#00d4ff" />
        <MetricChart data={history} dataKey="ram" label="RAM Usage" unit="%" color="#00ff88" />
        <MetricChart data={history} dataKey="disk" label="Disk Usage" unit="%" color="#ffd700" />
        <MetricChart
          data={history}
          dataKey="net_out"
          label="Network Out"
          unit=" KB/s"
          color="#a855f7"
          domain={[0, 'auto']}
        />
      </div>

      {/* Stats cards */}
      {metrics && isOnline && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { icon: Cpu, label: 'RAM Total', value: `${metrics.ram_total_mb?.toFixed(0)} MB`, color: '#00ff88' },
            { icon: HardDrive, label: 'Disk Total', value: `${metrics.disk_total_gb?.toFixed(1)} GB`, color: '#ffd700' },
            { icon: Network, label: 'Net Sent', value: formatBytes(metrics.net_bytes_sent), color: '#a855f7' },
            { icon: Network, label: 'Net Recv', value: formatBytes(metrics.net_bytes_recv), color: '#00d4ff' },
          ].map(({ icon: Icon, label, value, color }) => (
            <div key={label} className="glass-card p-3 flex items-center gap-3">
              <Icon size={18} style={{ color }} />
              <div>
                <div className="text-text-muted text-xs font-mono">{label}</div>
                <div className="text-text-primary text-sm font-mono font-semibold">{value}</div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Command runner */}
      <div className="glass-card p-5">
        <h3 className="section-title flex items-center gap-2 text-sm mb-4">
          <Terminal size={14} />
          Command Runner
        </h3>
        <div className="flex gap-2 mb-3">
          <input
            type="text"
            value={command}
            onChange={(e) => setCommand(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && !running && handleRunCommand()}
            className="input-field flex-1"
            placeholder="df -h | grep -v tmpfs"
            disabled={running}
          />
          <button
            onClick={handleRunCommand}
            disabled={running || !command.trim()}
            className="btn-primary flex items-center gap-2 whitespace-nowrap"
          >
            {running ? (
              <span className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
            ) : (
              <Play size={14} />
            )}
            {running ? 'Running...' : 'Run'}
          </button>
        </div>

        {output !== null && (
          <div ref={terminalRef} className="terminal">
            {output.stdout && (
              <pre className="whitespace-pre-wrap text-accent-green">{output.stdout}</pre>
            )}
            {output.stderr && (
              <pre className="whitespace-pre-wrap text-accent-red mt-1">{output.stderr}</pre>
            )}
            <div className="text-text-muted text-xs mt-2 pt-2 border-t border-border">
              Exit: {output.returncode} · {output.duration_ms?.toFixed(0)}ms
            </div>
          </div>
        )}
      </div>

      {/* Scheduled tasks */}
      <SchedulePanel serverId={id} />

      {/* Reboot confirmation */}
      <ConfirmModal
        isOpen={showRebootModal}
        title={`Reboot ${server.name}?`}
        message="This will immediately reboot the server. All running processes will be interrupted."
        onConfirm={handleReboot}
        onCancel={() => setShowRebootModal(false)}
        danger
      />
    </div>
  )
}
