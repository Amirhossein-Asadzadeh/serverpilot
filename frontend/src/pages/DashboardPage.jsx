/**
 * DashboardPage — Main grid of server cards with live metrics via WebSocket.
 *
 * The useWebSocket hook maintains a persistent WebSocket connection that
 * broadcasts all servers' metrics every 5 seconds. This page merges the
 * WebSocket data with the server list to display real-time stats.
 */

import { useEffect, useState } from 'react'
import { Activity, RefreshCw, Server, Wifi, WifiOff } from 'lucide-react'
import ServerCard from '../components/ServerCard'
import { ServerCardSkeleton } from '../components/LoadingSkeleton'
import { useWebSocket } from '../hooks/useWebSocket'
import api from '../api/api'
import toast from 'react-hot-toast'

export default function DashboardPage() {
  const [servers, setServers] = useState([])
  const [loading, setLoading] = useState(true)
  const { data: wsData, status: wsStatus } = useWebSocket()

  // Build a map of server_id → metrics from the latest WebSocket broadcast
  const metricsMap = {}
  if (wsData?.servers) {
    for (const m of wsData.servers) {
      metricsMap[m.server_id] = m
    }
  }

  const fetchServers = async () => {
    try {
      const resp = await api.get('/servers')
      setServers(resp.data)
    } catch (err) {
      toast.error('Failed to load servers')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchServers()
  }, [])

  const onlineCount = servers.filter(
    (s) => metricsMap[s.id]?.is_online ?? s.is_online,
  ).length

  return (
    <div className="p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="section-title flex items-center gap-2">
            <Activity size={18} />
            Dashboard
          </h1>
          <p className="text-text-muted text-sm font-mono mt-1">
            {loading ? '—' : `${onlineCount}/${servers.length} servers online`}
          </p>
        </div>

        <div className="flex items-center gap-3">
          {/* WebSocket status */}
          <div
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-mono"
            style={{ background: '#111827', border: '1px solid #1e2d45' }}
          >
            {wsStatus === 'connected' ? (
              <>
                <Wifi size={12} className="text-accent-green" />
                <span className="text-accent-green">Live</span>
              </>
            ) : wsStatus === 'connecting' ? (
              <>
                <Wifi size={12} className="text-accent-yellow animate-pulse" />
                <span className="text-accent-yellow">Connecting</span>
              </>
            ) : (
              <>
                <WifiOff size={12} className="text-accent-red" />
                <span className="text-accent-red">Offline</span>
              </>
            )}
          </div>

          <button
            onClick={fetchServers}
            className="p-2 rounded-lg hover:bg-bg-elevated transition-colors text-text-muted hover:text-text-primary"
            title="Refresh server list"
          >
            <RefreshCw size={16} />
          </button>
        </div>
      </div>

      {/* Server grid */}
      {loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <ServerCardSkeleton key={i} />
          ))}
        </div>
      ) : servers.length === 0 ? (
        <div className="flex flex-col items-center justify-center h-64 gap-4 text-center">
          <div
            className="w-16 h-16 rounded-2xl flex items-center justify-center"
            style={{ background: '#111827', border: '1px solid #1e2d45' }}
          >
            <Server size={28} className="text-text-muted" />
          </div>
          <div>
            <p className="text-text-primary font-semibold mb-1">No servers yet</p>
            <p className="text-text-muted text-sm font-mono">
              Go to Settings to add your first server.
            </p>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {servers.map((server) => (
            <ServerCard
              key={server.id}
              server={server}
              metrics={metricsMap[server.id]}
            />
          ))}
        </div>
      )}
    </div>
  )
}
