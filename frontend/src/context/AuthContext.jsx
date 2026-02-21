/**
 * AuthContext — JWT authentication state management
 *
 * Stores the JWT token in localStorage for persistence across page reloads.
 * All API calls include the token via axios interceptor (see api.js).
 *
 * Flow:
 *   1. User submits login form → POST /api/auth/login → receives token
 *   2. Token stored in localStorage + context state
 *   3. ProtectedRoute checks context for token presence
 *   4. Logout clears token from both localStorage and context
 */

import { createContext, useCallback, useContext, useEffect, useState } from 'react'
import api from '../api/api'

const AuthContext = createContext(null)

const TOKEN_KEY = 'serverpilot_token'
const USER_KEY = 'serverpilot_user'

export function AuthProvider({ children }) {
  const [token, setToken] = useState(() => localStorage.getItem(TOKEN_KEY))
  const [user, setUser] = useState(() => {
    const stored = localStorage.getItem(USER_KEY)
    return stored ? JSON.parse(stored) : null
  })
  const [loading, setLoading] = useState(false)

  // Keep axios default header in sync with token state
  useEffect(() => {
    if (token) {
      api.defaults.headers.common['Authorization'] = `Bearer ${token}`
    } else {
      delete api.defaults.headers.common['Authorization']
    }
  }, [token])

  const login = useCallback(async (username, password) => {
    // OAuth2PasswordRequestForm expects form-encoded data
    const formData = new URLSearchParams()
    formData.append('username', username)
    formData.append('password', password)

    const resp = await api.post('/auth/login', formData, {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    })

    const { access_token, username: uname, user_id } = resp.data
    const userData = { username: uname, user_id }

    localStorage.setItem(TOKEN_KEY, access_token)
    localStorage.setItem(USER_KEY, JSON.stringify(userData))
    setToken(access_token)
    setUser(userData)

    return userData
  }, [])

  const logout = useCallback(() => {
    localStorage.removeItem(TOKEN_KEY)
    localStorage.removeItem(USER_KEY)
    setToken(null)
    setUser(null)
  }, [])

  return (
    <AuthContext.Provider value={{ token, user, login, logout, loading }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
