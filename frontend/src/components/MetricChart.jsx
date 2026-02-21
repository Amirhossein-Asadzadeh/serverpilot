/**
 * MetricChart — Real-time line chart for CPU/RAM/Disk/Network metrics.
 *
 * Maintains a rolling window of the last 60 data points.
 * Uses Recharts with custom styling to match the cyberpunk theme.
 */

import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'

const CHART_COLORS = {
  cpu: '#00d4ff',
  ram: '#00ff88',
  disk: '#ffd700',
  net: '#a855f7',
}

function CustomTooltip({ active, payload, label, unit }) {
  if (!active || !payload?.length) return null
  return (
    <div
      className="px-3 py-2 rounded text-xs font-mono"
      style={{
        background: '#0d1220',
        border: '1px solid #1e2d45',
        color: '#e2e8f0',
      }}
    >
      <p className="text-text-muted mb-1">{label}</p>
      {payload.map((entry, i) => (
        <p key={i} style={{ color: entry.color }}>
          {entry.name}: {typeof entry.value === 'number' ? entry.value.toFixed(1) : entry.value}
          {unit}
        </p>
      ))}
    </div>
  )
}

export default function MetricChart({ data, dataKey, color, label, unit = '%', domain = [0, 100] }) {
  const chartColor = color || CHART_COLORS[dataKey] || '#00d4ff'

  return (
    <div className="glass-card p-4">
      <div className="flex items-center justify-between mb-3">
        <span className="text-xs font-mono uppercase tracking-widest" style={{ color: chartColor }}>
          {label}
        </span>
        <span className="text-xs font-mono text-text-muted">
          {data.length > 0
            ? `${typeof data[data.length - 1]?.[dataKey] === 'number'
                ? data[data.length - 1][dataKey].toFixed(1)
                : '—'}${unit}`
            : '—'}
        </span>
      </div>
      <ResponsiveContainer width="100%" height={100}>
        <AreaChart data={data} margin={{ top: 0, right: 0, bottom: 0, left: -20 }}>
          <defs>
            <linearGradient id={`grad-${dataKey}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor={chartColor} stopOpacity={0.25} />
              <stop offset="95%" stopColor={chartColor} stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid
            strokeDasharray="3 3"
            stroke="#1e2d4522"
            vertical={false}
          />
          <XAxis dataKey="time" tick={false} axisLine={false} tickLine={false} />
          <YAxis
            domain={domain}
            tick={{ fill: '#475569', fontSize: 10, fontFamily: 'JetBrains Mono' }}
            axisLine={false}
            tickLine={false}
            width={35}
            tickFormatter={(v) => `${v}${unit}`}
          />
          <Tooltip
            content={<CustomTooltip unit={unit} />}
            cursor={{ stroke: chartColor + '44', strokeWidth: 1 }}
          />
          <Area
            type="monotone"
            dataKey={dataKey}
            name={label}
            stroke={chartColor}
            strokeWidth={2}
            fill={`url(#grad-${dataKey})`}
            dot={false}
            activeDot={{ r: 3, fill: chartColor, strokeWidth: 0 }}
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  )
}
