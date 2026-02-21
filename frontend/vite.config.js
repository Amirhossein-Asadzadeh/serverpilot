import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    port: 3000,
    proxy: {
      // Proxy API requests to backend during development
      '/api': {
        target: 'http://localhost:8000',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ''),
      },
      // WebSocket proxy for live metrics
      '/ws': {
        target: 'ws://localhost:8000',
        ws: true,
        rewrite: (path) => path.replace(/^\/ws/, '/ws'),
      },
    },
  },
})
