/**
 * CircularGauge — SVG-based circular progress indicator for CPU/RAM.
 *
 * Uses SVG stroke-dasharray/dashoffset technique for smooth circular progress.
 * Color changes based on value: green → yellow → red.
 */

export default function CircularGauge({ value = 0, label, size = 80 }) {
  const radius = (size - 10) / 2
  const circumference = 2 * Math.PI * radius
  const progress = Math.min(Math.max(value, 0), 100)
  const dashoffset = circumference - (progress / 100) * circumference

  // Color based on load level
  const getColor = (val) => {
    if (val < 60) return '#00ff88'
    if (val < 85) return '#ffd700'
    return '#ff4444'
  }

  const color = getColor(progress)
  const cx = size / 2
  const cy = size / 2

  return (
    <div className="flex flex-col items-center gap-1">
      <div className="relative" style={{ width: size, height: size }}>
        <svg width={size} height={size} className="rotate-[-90deg]">
          {/* Background track */}
          <circle
            cx={cx}
            cy={cy}
            r={radius}
            fill="none"
            stroke="#1e2d45"
            strokeWidth={6}
          />
          {/* Progress arc */}
          <circle
            cx={cx}
            cy={cy}
            r={radius}
            fill="none"
            stroke={color}
            strokeWidth={6}
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={dashoffset}
            style={{
              transition: 'stroke-dashoffset 0.5s ease, stroke 0.3s ease',
              filter: `drop-shadow(0 0 4px ${color}88)`,
            }}
          />
        </svg>
        {/* Center text */}
        <div
          className="absolute inset-0 flex items-center justify-center"
          style={{ color, fontFamily: 'JetBrains Mono, monospace' }}
        >
          <span className="text-xs font-bold">{Math.round(progress)}%</span>
        </div>
      </div>
      <span className="text-text-muted text-xs font-mono uppercase tracking-wide">
        {label}
      </span>
    </div>
  )
}
