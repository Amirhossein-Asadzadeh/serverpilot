/**
 * ServerCard — Dashboard grid card for a single server.
 *
 * Shows:
 * - Server name, IP, tags
 * - Online/offline pulsing indicator
 * - CPU and RAM circular gauges
 * - Disk usage bar
 * - Uptime
 * - Quick reboot button
 */

import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Power, ChevronRight, HardDrive, Clock } from 'lucide-react'
import CircularGauge from './CircularGauge'
import toast from 'react-hot-toast'
import api from '../api/api'

// How long (ms) to wait after receiving is_online=false before actually
// rendering the offline state.  This is a frontend-side safety net on top of
// the backend's 3-consecutive-failure threshold.  Together they mean the user
// only sees "OFFLINE" after the server has been unreachable for ~25-30 seconds.
const OFFLINE_GRACE_MS = 12_000

function formatUptime(seconds) {
  if (!seconds) return '—'
  const d = Math.floor(seconds / 86400)
  const h = Math.floor((seconds % 86400) / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  if (d > 0) return `${d}d ${h}h`
  if (h > 0) return `${h}h ${m}m`
  return `${m}m`
}

function Tag({ label }) {
  return (
    <span
      className="px-1.5 py-0.5 rounded text-xs font-mono"
      style={{
        background: '#00d4ff11',
        border: '1px solid #00d4ff22',
        color: '#00d4ff99',
      }}
    >
      {label}
    </span>
  )
}

export default function ServerCard({ server, metrics }) {
  const navigate = useNavigate()

  // Raw online status from the latest WebSocket message (or DB fallback).
  const rawOnline = metrics?.is_online ?? server.is_online ?? false

  // Displayed online status — debounced so a brief is_online=false message
  // doesn't immediately flip the card to "OFFLINE".
  const [isOnline, setIsOnline] = useState(rawOnline)
  const offlineTimerRef = useRef(null)

  useEffect(() => {
    if (rawOnline) {
      // Server came (back) online — cancel any pending offline timer and
      // immediately show the online state.
      if (offlineTimerRef.current) {
        clearTimeout(offlineTimerRef.current)
        offlineTimerRef.current = null
      }
      setIsOnline(true)
    } else {
      // Server looks offline — start a grace-period timer.
      // If rawOnline flips back to true before the timer fires, it's cancelled above.
      if (!offlineTimerRef.current) {
        offlineTimerRef.current = setTimeout(() => {
          setIsOnline(false)
          offlineTimerRef.current = null
        }, OFFLINE_GRACE_MS)
      }
    }
  }, [rawOnline])

  // Clean up the timer if the card is unmounted (e.g., server was deleted).
  useEffect(() => {
    return () => {
      if (offlineTimerRef.current) clearTimeout(offlineTimerRef.current)
    }
  }, [])

  const handleReboot = async (e) => {
    e.stopPropagation() // Don't navigate to detail
    if (!confirm(`Reboot ${server.name}?`)) return

    try {
      await api.post(`/servers/${server.id}/reboot`)
      toast.success(`Reboot initiated on ${server.name}`)
    } catch (err) {
      toast.error(`Reboot failed: ${err.response?.data?.detail || err.message}`)
    }
  }

  const cpu = metrics?.cpu_percent ?? 0
  const ram = metrics?.ram_percent ?? 0
  const disk = metrics?.disk_percent ?? 0
  const uptime = metrics?.uptime_seconds ?? 0

  return (
    <div
      onClick={() => navigate(`/servers/${server.id}`)}
      className="glass-card glow-border p-4 cursor-pointer animate-fade-in relative overflow-hidden"
      style={{ transition: 'transform 0.15s ease' }}
      onMouseEnter={(e) => (e.currentTarget.style.transform = 'translateY(-2px)')}
      onMouseLeave={(e) => (e.currentTarget.style.transform = 'translateY(0)')}
    >
      {/* Subtle top gradient accent */}
      {isOnline && (
        <div
          className="absolute top-0 left-0 right-0 h-px"
          style={{ background: 'linear-gradient(90deg, transparent, #00d4ff44, transparent)' }}
        />
      )}

      {/* Header */}
      <div className="flex items-start justify-between mb-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            {/* Status indicator */}
            <span className={`status-dot ${isOnline ? 'online' : 'offline'}`} />
            <h3 className="font-heading font-semibold text-base text-text-primary truncate">
              {server.name}
            </h3>
          </div>
          <p className="text-text-muted text-xs font-mono truncate">
            {server.ip}:{server.port}
          </p>
        </div>

        <div className="flex items-center gap-1 ml-2">
          <button
            onClick={handleReboot}
            className="p-1.5 rounded transition-colors hover:bg-red-500/10 text-text-muted hover:text-accent-red"
            title="Reboot server"
          >
            <Power size={14} />
          </button>
          <ChevronRight size={14} className="text-text-muted" />
        </div>
      </div>

      {/* Tags */}
      {server.tags?.length > 0 && (
        <div className="flex flex-wrap gap-1 mb-3">
          {server.tags.slice(0, 3).map((tag) => (
            <Tag key={tag} label={tag} />
          ))}
        </div>
      )}

      {/* Gauges */}
      {isOnline ? (
        <>
          <div className="flex justify-around mb-3">
            <CircularGauge value={cpu} label="CPU" size={72} />
            <CircularGauge value={ram} label="RAM" size={72} />
          </div>

          {/* Disk bar */}
          <div className="mb-3">
            <div className="flex justify-between text-xs font-mono text-text-muted mb-1">
              <div className="flex items-center gap-1">
                <HardDrive size={11} />
                <span>Disk</span>
              </div>
              <span>{Math.round(disk)}%</span>
            </div>
            <div className="h-1.5 rounded-full bg-bg-elevated overflow-hidden">
              <div
                className="h-full rounded-full transition-all duration-500"
                style={{
                  width: `${disk}%`,
                  background:
                    disk < 70
                      ? '#00ff88'
                      : disk < 90
                      ? '#ffd700'
                      : '#ff4444',
                  boxShadow:
                    disk < 70
                      ? '0 0 6px #00ff8844'
                      : disk < 90
                      ? '0 0 6px #ffd70044'
                      : '0 0 6px #ff444444',
                }}
              />
            </div>
          </div>

          {/* Uptime */}
          <div className="flex items-center gap-1 text-xs font-mono text-text-muted">
            <Clock size={11} />
            <span>Up {formatUptime(uptime)}</span>
          </div>
        </>
      ) : (
        <div className="flex flex-col items-center justify-center h-24 gap-2">
          <div className="text-accent-red text-xs font-mono">OFFLINE</div>
          {server.last_seen && (
            <div className="text-text-muted text-xs font-mono">
              Last seen: {new Date(server.last_seen).toLocaleString()}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
