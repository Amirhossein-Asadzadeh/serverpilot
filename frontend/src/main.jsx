import React from 'react'
import ReactDOM from 'react-dom/client'
import { Toaster } from 'react-hot-toast'
import App from './App'
import './index.css'

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
    <Toaster
      position="bottom-right"
      toastOptions={{
        style: {
          background: '#111827',
          color: '#e2e8f0',
          border: '1px solid #1e2d45',
          fontFamily: 'JetBrains Mono, monospace',
          fontSize: '13px',
        },
        success: {
          iconTheme: { primary: '#00ff88', secondary: '#111827' },
        },
        error: {
          iconTheme: { primary: '#ff4444', secondary: '#111827' },
        },
        duration: 4000,
      }}
    />
  </React.StrictMode>,
)
