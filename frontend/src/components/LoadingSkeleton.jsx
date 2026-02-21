/**
 * LoadingSkeleton — Animated placeholder cards shown while data is loading.
 */

export function ServerCardSkeleton() {
  return (
    <div className="glass-card p-4">
      <div className="flex items-start justify-between mb-3">
        <div className="flex-1">
          <div className="skeleton h-5 w-32 mb-2" />
          <div className="skeleton h-3 w-24" />
        </div>
        <div className="skeleton w-6 h-6 rounded" />
      </div>
      <div className="flex justify-around mb-3">
        <div className="skeleton w-16 h-16 rounded-full" />
        <div className="skeleton w-16 h-16 rounded-full" />
      </div>
      <div className="skeleton h-1.5 w-full rounded-full mb-3" />
      <div className="skeleton h-3 w-20" />
    </div>
  )
}

export function TableRowSkeleton({ cols = 5 }) {
  return (
    <tr>
      {Array.from({ length: cols }).map((_, i) => (
        <td key={i} className="px-4 py-3">
          <div className="skeleton h-4 w-full" style={{ maxWidth: `${60 + Math.random() * 40}%` }} />
        </td>
      ))}
    </tr>
  )
}

export function ChartSkeleton() {
  return (
    <div className="glass-card p-4">
      <div className="skeleton h-4 w-16 mb-3" />
      <div className="skeleton h-24 w-full rounded" />
    </div>
  )
}
