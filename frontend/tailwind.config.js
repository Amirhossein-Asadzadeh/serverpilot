/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // Cyberpunk / terminal color palette
        bg: {
          primary: '#0a0e1a',
          secondary: '#0d1220',
          card: '#111827',
          elevated: '#1a2236',
        },
        accent: {
          cyan: '#00d4ff',
          green: '#00ff88',
          red: '#ff4444',
          yellow: '#ffd700',
          purple: '#a855f7',
        },
        border: {
          DEFAULT: '#1e2d45',
          glow: '#00d4ff33',
        },
        text: {
          primary: '#e2e8f0',
          secondary: '#94a3b8',
          muted: '#475569',
        },
      },
      fontFamily: {
        mono: ['JetBrains Mono', 'Fira Code', 'Consolas', 'monospace'],
        heading: ['Rajdhani', 'Orbitron', 'sans-serif'],
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
      animation: {
        'pulse-slow': 'pulse 3s ease-in-out infinite',
        'glow': 'glow 2s ease-in-out infinite alternate',
        'scan': 'scan 2s linear infinite',
        'fade-in': 'fadeIn 0.3s ease-in-out',
      },
      keyframes: {
        glow: {
          '0%': { boxShadow: '0 0 5px #00d4ff33' },
          '100%': { boxShadow: '0 0 20px #00d4ff88, 0 0 40px #00d4ff33' },
        },
        scan: {
          '0%': { transform: 'translateY(-100%)' },
          '100%': { transform: 'translateY(100vh)' },
        },
        fadeIn: {
          '0%': { opacity: '0', transform: 'translateY(8px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
      },
      backgroundImage: {
        'grid-pattern': `linear-gradient(rgba(0, 212, 255, 0.03) 1px, transparent 1px),
                         linear-gradient(90deg, rgba(0, 212, 255, 0.03) 1px, transparent 1px)`,
      },
      backgroundSize: {
        'grid': '40px 40px',
      },
    },
  },
  plugins: [],
}
