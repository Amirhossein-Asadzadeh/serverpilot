import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { AuthProvider } from './context/AuthContext'
import { useAuth } from './context/AuthContext'
import Layout from './components/Layout'
import LoginPage from './pages/LoginPage'
import DashboardPage from './pages/DashboardPage'
import ServerDetailPage from './pages/ServerDetailPage'
import AuditLogPage from './pages/AuditLogPage'
import SettingsPage from './pages/SettingsPage'

// Protected route wrapper — redirects to login if not authenticated
function ProtectedRoute({ children }) {
  const { token, loading } = useAuth()

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-bg-primary">
        <div className="text-accent-cyan font-mono text-sm animate-pulse">
          Initializing...
        </div>
      </div>
    )
  }

  return token ? children : <Navigate to="/login" replace />
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route
            path="/"
            element={
              <ProtectedRoute>
                <Layout />
              </ProtectedRoute>
            }
          >
            <Route index element={<DashboardPage />} />
            <Route path="servers/:id" element={<ServerDetailPage />} />
            <Route path="audit" element={<AuditLogPage />} />
            <Route path="settings" element={<SettingsPage />} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  )
}
