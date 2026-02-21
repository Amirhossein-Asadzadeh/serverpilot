/**
 * Layout — Main application shell with sidebar navigation.
 * Wraps all authenticated pages via React Router's <Outlet />.
 */

import { Link, NavLink, Outlet, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import {
  Activity,
  ClipboardList,
  LogOut,
  Server,
  Settings,
  Zap,
} from 'lucide-react'
import { useWebSocket } from '../hooks/useWebSocket'

const navItems = [
  { to: '/', label: 'Dashboard', icon: Activity, end: true },
  { to: '/audit', label: 'Audit Log', icon: ClipboardList },
  { to: '/settings', label: 'Settings', icon: Settings },
]

function WSStatusDot({ status }) {
  const colors = {
    connected: 'bg-accent-green',
    connecting: 'bg-accent-yellow animate-pulse',
    disconnected: 'bg-accent-red',
  }
  const labels = {
    connected: 'Live',
    connecting: 'Connecting...',
    disconnected: 'Offline',
  }
  return (
    <div className="flex items-center gap-1.5 text-xs font-mono text-text-secondary">
      <span className={`w-1.5 h-1.5 rounded-full ${colors[status]}`} />
      {labels[status]}
    </div>
  )
}

export default function Layout() {
  const { user, logout } = useAuth()
  const navigate = useNavigate()
  const { status: wsStatus } = useWebSocket()

  const handleLogout = () => {
    logout()
    navigate('/login')
  }

  return (
    <div className="flex h-screen bg-bg-primary overflow-hidden">
      {/* ─── Sidebar ─────────────────────────────────────────────────────── */}
      <aside className="w-56 flex flex-col border-r border-border bg-bg-secondary flex-shrink-0">
        {/* Logo */}
        <div className="p-5 border-b border-border">
          <div className="flex items-center gap-2.5">
            <div
              className="w-8 h-8 rounded-lg flex items-center justify-center"
              style={{
                background: 'linear-gradient(135deg, #00d4ff33, #00ff8833)',
                border: '1px solid #00d4ff44',
              }}
            >
              <Zap size={16} className="text-accent-cyan" />
            </div>
            <div>
              <div className="font-heading font-bold text-base tracking-widest text-accent-cyan">
                SERVER
              </div>
              <div className="font-heading font-bold text-base tracking-widest text-accent-green" style={{ marginTop: '-4px' }}>
                PILOT
              </div>
            </div>
          </div>
        </div>

        {/* Navigation */}
        <nav className="flex-1 p-3 space-y-1">
          {navItems.map(({ to, label, icon: Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-150 ${
                  isActive
                    ? 'bg-accent-cyan/10 text-accent-cyan border border-accent-cyan/20'
                    : 'text-text-secondary hover:text-text-primary hover:bg-bg-elevated'
                }`
              }
            >
              <Icon size={16} />
              {label}
            </NavLink>
          ))}
        </nav>

        {/* Bottom section */}
        <div className="p-3 border-t border-border space-y-2">
          <WSStatusDot status={wsStatus} />
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="w-6 h-6 rounded-full bg-accent-cyan/20 border border-accent-cyan/30 flex items-center justify-center">
                <span className="text-accent-cyan text-xs font-mono font-bold">
                  {user?.username?.[0]?.toUpperCase() || 'A'}
                </span>
              </div>
              <span className="text-text-secondary text-xs font-mono truncate max-w-24">
                {user?.username || 'admin'}
              </span>
            </div>
            <button
              onClick={handleLogout}
              className="p-1.5 rounded hover:bg-bg-elevated text-text-muted hover:text-accent-red transition-colors"
              title="Logout"
            >
              <LogOut size={14} />
            </button>
          </div>
        </div>
      </aside>

      {/* ─── Main content ─────────────────────────────────────────────────── */}
      <main className="flex-1 overflow-y-auto grid-bg">
        <div className="page-enter">
          <Outlet />
        </div>
      </main>
    </div>
  )
}
