/**
 * useWebSocket — Custom hook for WebSocket connection with auto-reconnect.
 *
 * Features:
 * - Connects to /ws/metrics with JWT token as query param
 * - Exponential backoff reconnection (max 30s between retries)
 * - Cleans up on component unmount
 * - Provides connection status to the UI
 *
 * Usage:
 *   const { data, status } = useWebSocket()
 *   // data: { type: 'metrics_update', servers: [...] }
 *   // status: 'connecting' | 'connected' | 'disconnected'
 */

import { useCallback, useEffect, useRef, useState } from 'react'

const WS_BASE = import.meta.env.VITE_WS_URL || `ws://${window.location.host}/ws`

export function useWebSocket() {
  const [data, setData] = useState(null)
  const [status, setStatus] = useState('disconnected')
  const wsRef = useRef(null)
  const reconnectTimeoutRef = useRef(null)
  const retryCountRef = useRef(0)
  const isMountedRef = useRef(true)

  const connect = useCallback(() => {
    if (!isMountedRef.current) return

    const token = localStorage.getItem('serverpilot_token')
    if (!token) {
      setStatus('disconnected')
      return
    }

    setStatus('connecting')

    const wsUrl = `${WS_BASE}/metrics?token=${token}`
    const ws = new WebSocket(wsUrl)
    wsRef.current = ws

    ws.onopen = () => {
      if (!isMountedRef.current) return
      setStatus('connected')
      retryCountRef.current = 0 // Reset retry counter on successful connection
    }

    ws.onmessage = (event) => {
      if (!isMountedRef.current) return
      try {
        const parsed = JSON.parse(event.data)
        setData(parsed)
      } catch (err) {
        console.warn('[WebSocket] Failed to parse message:', err)
      }
    }

    ws.onclose = () => {
      if (!isMountedRef.current) return
      setStatus('disconnected')
      wsRef.current = null

      // Exponential backoff: 1s, 2s, 4s, 8s, 16s, 30s (cap)
      const delay = Math.min(1000 * Math.pow(2, retryCountRef.current), 30000)
      retryCountRef.current += 1

      console.log(`[WebSocket] Disconnected. Reconnecting in ${delay}ms...`)
      reconnectTimeoutRef.current = setTimeout(connect, delay)
    }

    ws.onerror = (err) => {
      console.warn('[WebSocket] Error:', err)
      ws.close() // Triggers onclose which handles reconnection
    }
  }, [])

  useEffect(() => {
    isMountedRef.current = true
    connect()

    return () => {
      isMountedRef.current = false
      clearTimeout(reconnectTimeoutRef.current)
      if (wsRef.current) {
        wsRef.current.close()
        wsRef.current = null
      }
    }
  }, [connect])

  const disconnect = useCallback(() => {
    isMountedRef.current = false
    clearTimeout(reconnectTimeoutRef.current)
    if (wsRef.current) {
      wsRef.current.close()
      wsRef.current = null
    }
    setStatus('disconnected')
  }, [])

  return { data, status, reconnect: connect, disconnect }
}
