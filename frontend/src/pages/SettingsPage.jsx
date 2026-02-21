/**
 * SettingsPage — Add, edit, and delete server registrations.
 *
 * Each server record contains:
 *   - Display name (e.g., "prod-web-01")
 *   - IP address of the VPS
 *   - Port the agent is listening on (default 8765)
 *   - Agent token (shared secret for agent API auth)
 *   - Tags for grouping/filtering
 */

import { useEffect, useState } from 'react'
import {
  Edit2,
  Plus,
  RefreshCw,
  Save,
  Server,
  Settings,
  Tag,
  Trash2,
  X,
} from 'lucide-react'
import ConfirmModal from '../components/ConfirmModal'
import api from '../api/api'
import toast from 'react-hot-toast'

const EMPTY_FORM = {
  name: '',
  ip: '',
  port: '8765',
  agent_token: '',
  tags: '',
}

function ServerForm({ initial = EMPTY_FORM, onSave, onCancel, isEdit }) {
  const [form, setForm] = useState(initial)
  const [saving, setSaving] = useState(false)

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value })

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!form.name || !form.ip || !form.agent_token) {
      toast.error('Name, IP, and token are required')
      return
    }
    setSaving(true)
    try {
      const payload = {
        ...form,
        port: parseInt(form.port) || 8765,
        tags: form.tags
          ? form.tags.split(',').map((t) => t.trim()).filter(Boolean)
          : [],
      }
      await onSave(payload)
    } finally {
      setSaving(false)
    }
  }

  const fields = [
    { key: 'name', label: 'Server Name', placeholder: 'prod-web-01', type: 'text' },
    { key: 'ip', label: 'IP Address', placeholder: '192.168.1.100', type: 'text' },
    { key: 'port', label: 'Agent Port', placeholder: '8765', type: 'number' },
    { key: 'agent_token', label: 'Agent Token', placeholder: 'your-secret-token', type: 'password' },
    { key: 'tags', label: 'Tags (comma-separated)', placeholder: 'prod, web, us-east', type: 'text' },
  ]

  return (
    <form
      onSubmit={handleSubmit}
      className="p-5 rounded-xl space-y-4"
      style={{ background: '#0a0e1a', border: '1px solid #1e2d45' }}
    >
      <h3 className="text-text-primary font-semibold text-base">
        {isEdit ? 'Edit Server' : 'Add New Server'}
      </h3>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {fields.map(({ key, label, placeholder, type }) => (
          <div key={key} className={key === 'agent_token' || key === 'tags' ? 'sm:col-span-2' : ''}>
            <label className="block text-xs font-mono text-text-muted mb-1.5 uppercase tracking-wider">
              {label}
            </label>
            <input
              type={type}
              value={form[key]}
              onChange={set(key)}
              className="input-field"
              placeholder={placeholder}
            />
          </div>
        ))}
      </div>

      <div className="flex gap-3">
        <button
          type="submit"
          disabled={saving}
          className="btn-primary flex items-center gap-2"
        >
          {saving ? (
            <span className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
          ) : (
            <Save size={14} />
          )}
          {saving ? 'Saving...' : isEdit ? 'Update Server' : 'Add Server'}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="px-4 py-2 rounded-lg text-sm text-text-muted hover:text-text-primary border border-border hover:border-text-muted transition-colors"
        >
          Cancel
        </button>
      </div>
    </form>
  )
}

function ServerRow({ server, onEdit, onDelete }) {
  return (
    <div
      className="glass-card glow-border p-4 flex items-center justify-between gap-4"
    >
      <div className="flex items-center gap-3 flex-1 min-w-0">
        <div
          className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0"
          style={{ background: '#00d4ff11', border: '1px solid #00d4ff22' }}
        >
          <Server size={16} className="text-accent-cyan" />
        </div>
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className={`status-dot ${server.is_online ? 'online' : 'offline'}`} />
            <span className="font-semibold text-text-primary truncate">{server.name}</span>
          </div>
          <div className="text-text-muted text-xs font-mono">
            {server.ip}:{server.port}
          </div>
          {server.tags?.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-1">
              {server.tags.map((t) => (
                <span
                  key={t}
                  className="px-1.5 py-0.5 rounded text-xs font-mono"
                  style={{ background: '#00d4ff11', border: '1px solid #00d4ff22', color: '#00d4ff88' }}
                >
                  {t}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="flex items-center gap-2 flex-shrink-0">
        <button
          onClick={() => onEdit(server)}
          className="p-2 rounded-lg hover:bg-bg-elevated text-text-muted hover:text-accent-cyan transition-colors"
          title="Edit"
        >
          <Edit2 size={14} />
        </button>
        <button
          onClick={() => onDelete(server)}
          className="p-2 rounded-lg hover:bg-red-500/10 text-text-muted hover:text-accent-red transition-colors"
          title="Delete"
        >
          <Trash2 size={14} />
        </button>
      </div>
    </div>
  )
}

export default function SettingsPage() {
  const [servers, setServers] = useState([])
  const [loading, setLoading] = useState(true)
  const [showAddForm, setShowAddForm] = useState(false)
  const [editingServer, setEditingServer] = useState(null)
  const [deleteTarget, setDeleteTarget] = useState(null)

  const fetchServers = async () => {
    setLoading(true)
    try {
      const resp = await api.get('/servers')
      setServers(resp.data)
    } catch {
      toast.error('Failed to load servers')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchServers()
  }, [])

  const handleAdd = async (payload) => {
    try {
      await api.post('/servers', payload)
      toast.success(`Server "${payload.name}" added`)
      setShowAddForm(false)
      fetchServers()
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Failed to add server')
      throw err
    }
  }

  const handleEdit = async (payload) => {
    try {
      await api.put(`/servers/${editingServer.id}`, payload)
      toast.success(`Server "${payload.name}" updated`)
      setEditingServer(null)
      fetchServers()
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Failed to update server')
      throw err
    }
  }

  const handleDeleteConfirm = async () => {
    try {
      await api.delete(`/servers/${deleteTarget.id}`)
      toast.success(`Server "${deleteTarget.name}" removed`)
      setDeleteTarget(null)
      fetchServers()
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Failed to delete server')
    }
  }

  return (
    <div className="p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="section-title flex items-center gap-2">
            <Settings size={18} />
            Settings
          </h1>
          <p className="text-text-muted text-sm font-mono mt-1">
            Manage registered servers
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={fetchServers}
            className="p-2 rounded-lg hover:bg-bg-elevated transition-colors text-text-muted hover:text-text-primary"
          >
            <RefreshCw size={16} />
          </button>
          <button
            onClick={() => { setShowAddForm(true); setEditingServer(null) }}
            className="btn-primary flex items-center gap-2"
          >
            <Plus size={14} />
            Add Server
          </button>
        </div>
      </div>

      {/* Add form */}
      {showAddForm && (
        <div className="mb-5">
          <ServerForm
            onSave={handleAdd}
            onCancel={() => setShowAddForm(false)}
            isEdit={false}
          />
        </div>
      )}

      {/* Server list */}
      {loading ? (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="glass-card p-4 h-16 skeleton" />
          ))}
        </div>
      ) : servers.length === 0 ? (
        <div className="glass-card p-12 text-center">
          <Server size={32} className="text-text-muted mx-auto mb-3" />
          <p className="text-text-primary font-semibold mb-1">No servers registered</p>
          <p className="text-text-muted text-sm font-mono">
            Click "Add Server" to register your first VPS.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {servers.map((server) =>
            editingServer?.id === server.id ? (
              <ServerForm
                key={server.id}
                initial={{
                  name: server.name,
                  ip: server.ip,
                  port: String(server.port),
                  agent_token: '',
                  tags: (server.tags || []).join(', '),
                }}
                onSave={handleEdit}
                onCancel={() => setEditingServer(null)}
                isEdit
              />
            ) : (
              <ServerRow
                key={server.id}
                server={server}
                onEdit={setEditingServer}
                onDelete={setDeleteTarget}
              />
            ),
          )}
        </div>
      )}

      {/* Agent install instructions */}
      <div className="mt-8 glass-card p-5">
        <h3 className="section-title text-sm mb-3">Agent Installation</h3>
        <p className="text-text-muted text-sm mb-3">
          Run this one-liner on each VPS to install the ServerPilot agent:
        </p>
        <div className="terminal text-xs">
          <span className="text-accent-green">$</span>{' '}
          <span className="text-text-primary">
            {'AGENT_TOKEN=your-secret-token bash <(curl -sSL https://your-panel.com/install-agent.sh)'}
          </span>
        </div>
        <p className="text-text-muted text-xs font-mono mt-3">
          The token must match what you enter in "Agent Token" above.
          Use <code className="text-accent-cyan">secrets.token_hex(32)</code> to generate a secure token.
        </p>
      </div>

      {/* Delete confirmation */}
      <ConfirmModal
        isOpen={!!deleteTarget}
        title={`Delete ${deleteTarget?.name}?`}
        message="This will remove the server from the panel. The agent on the VPS will not be uninstalled."
        onConfirm={handleDeleteConfirm}
        onCancel={() => setDeleteTarget(null)}
        danger
      />
    </div>
  )
}
