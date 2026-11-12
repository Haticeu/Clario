import type { ReactNode } from 'react'
import type { Tone } from '../utils/labels'
import { Change } from './ui'

interface StatCardProps {
  label: string
  value: ReactNode
  /** Önceki döneme göre oransal değişim */
  change?: number | null
  hint?: ReactNode
  tone?: Tone
}

export function StatCard({ label, value, change, hint, tone = 'neutral' }: StatCardProps) {
  return (
    <div className={`panel stat-card tone-${tone}`}>
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value}</div>
      {(change !== undefined || hint) && (
        <div className="stat-footer">
          {change !== undefined && <Change value={change} />}
          {hint && <span>{hint}</span>}
        </div>
      )}
    </div>
  )
}

export function StatCardSkeleton() {
  return (
    <div className="panel stat-card" aria-hidden="true">
      <div className="skeleton" style={{ width: '45%', height: 13 }} />
      <div className="skeleton" style={{ width: '70%', height: 26, marginTop: 10 }} />
      <div className="skeleton" style={{ width: '55%', height: 12, marginTop: 12 }} />
    </div>
  )
}

export function StatGridSkeleton({ count = 4 }: { count?: number }) {
  return (
    <div className="grid grid-kpi" aria-busy="true" aria-label="Yükleniyor">
      {Array.from({ length: count }, (_, i) => (
        <StatCardSkeleton key={i} />
      ))}
    </div>
  )
}
