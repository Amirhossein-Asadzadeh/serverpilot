/**
 * Central Axios instance for all API calls.
 *
 * Features:
 * - Base URL configured from environment variable
 * - JWT token injected via request interceptor
 * - 401 responses auto-redirect to login (token expired)
 * - Consistent error handling
 */

import axios from 'axios'

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || '/api',
  timeout: 30000,
})

// ─── Request interceptor: inject JWT ─────────────────────────────────────────

api.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem('serverpilot_token')
    if (token) {
      config.headers['Authorization'] = `Bearer ${token}`
    }
    return config
  },
  (error) => Promise.reject(error),
)

// ─── Response interceptor: handle 401 globally ───────────────────────────────

api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      // Token expired or invalid — clear storage and redirect to login
      localStorage.removeItem('serverpilot_token')
      localStorage.removeItem('serverpilot_user')
      if (window.location.pathname !== '/login') {
        window.location.href = '/login'
      }
    }
    return Promise.reject(error)
  },
)

export default api
