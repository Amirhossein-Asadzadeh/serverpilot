/**
 * LoginPage — Centered login card with animated ServerPilot logo.
 *
 * On successful login, redirects to the dashboard.
 * JWT is stored in localStorage via AuthContext.
 */

import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { Eye, EyeOff, Zap, Lock, User } from 'lucide-react'
import toast from 'react-hot-toast'

export default function LoginPage() {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [showPw, setShowPw] = useState(false)
  const [loading, setLoading] = useState(false)
  const { login } = useAuth()
  const navigate = useNavigate()

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!username || !password) {
      toast.error('Enter username and password')
      return
    }
    setLoading(true)
    try {
      await login(username, password)
      navigate('/', { replace: true })
    } catch (err) {
      const msg = err.response?.data?.detail || 'Login failed'
      toast.error(msg)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div
      className="min-h-screen flex items-center justify-center grid-bg"
      style={{ background: '#0a0e1a' }}
    >
      {/* Scan line animation */}
      <div
        className="pointer-events-none fixed inset-0 overflow-hidden opacity-10"
        aria-hidden
      >
        <div
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            height: '1px',
            background: 'linear-gradient(90deg, transparent, #00d4ff, transparent)',
            animation: 'scan-line 4s linear infinite',
          }}
        />
      </div>

      <div className="w-full max-w-sm px-4 animate-fade-in">
        {/* Logo */}
        <div className="text-center mb-8">
          <div
            className="w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-4"
            style={{
              background: 'linear-gradient(135deg, #00d4ff22, #00ff8822)',
              border: '1px solid #00d4ff44',
              boxShadow: '0 0 30px #00d4ff22',
            }}
          >
            <Zap size={32} className="text-accent-cyan" />
          </div>
          <h1
            className="font-heading font-bold text-3xl tracking-widest"
            style={{ color: '#00d4ff' }}
          >
            SERVERPILOT
          </h1>
          <p className="text-text-muted text-sm font-mono mt-1">
            Infrastructure Control Panel
          </p>
        </div>

        {/* Card */}
        <div
          className="rounded-2xl p-8"
          style={{
            background: 'rgba(17, 24, 39, 0.9)',
            border: '1px solid #1e2d45',
            boxShadow: '0 0 40px #00000088, inset 0 1px 0 #ffffff08',
            backdropFilter: 'blur(20px)',
          }}
        >
          <h2 className="text-text-primary font-semibold text-base mb-6">
            Sign in to continue
          </h2>

          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Username */}
            <div>
              <label className="block text-xs font-mono text-text-muted mb-1.5 uppercase tracking-wider">
                Username
              </label>
              <div className="relative">
                <User
                  size={14}
                  className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted"
                />
                <input
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  className="input-field pl-9"
                  placeholder="admin"
                  autoComplete="username"
                  autoFocus
                />
              </div>
            </div>

            {/* Password */}
            <div>
              <label className="block text-xs font-mono text-text-muted mb-1.5 uppercase tracking-wider">
                Password
              </label>
              <div className="relative">
                <Lock
                  size={14}
                  className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted"
                />
                <input
                  type={showPw ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="input-field pl-9 pr-10"
                  placeholder="••••••••"
                  autoComplete="current-password"
                />
                <button
                  type="button"
                  onClick={() => setShowPw(!showPw)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-secondary transition-colors"
                >
                  {showPw ? <EyeOff size={14} /> : <Eye size={14} />}
                </button>
              </div>
            </div>

            {/* Submit */}
            <button
              type="submit"
              disabled={loading}
              className="w-full py-2.5 rounded-lg font-semibold text-sm transition-all duration-200 mt-2"
              style={{
                background: loading
                  ? '#1e2d45'
                  : 'linear-gradient(135deg, #00d4ff33, #00d4ff55)',
                border: `1px solid ${loading ? '#1e2d45' : '#00d4ff66'}`,
                color: loading ? '#475569' : '#00d4ff',
                boxShadow: loading ? 'none' : '0 0 20px #00d4ff22',
                cursor: loading ? 'not-allowed' : 'pointer',
              }}
            >
              {loading ? (
                <span className="flex items-center justify-center gap-2">
                  <span className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
                  Authenticating...
                </span>
              ) : (
                'Sign In'
              )}
            </button>
          </form>
        </div>

        <p className="text-center text-text-muted text-xs font-mono mt-6">
          ServerPilot v1.0.0 — Self-hosted infrastructure management
        </p>
      </div>
    </div>
  )
}
