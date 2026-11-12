/** Küçük, genel amaçlı arayüz parçaları. */
import type { ReactNode } from 'react'
import { formatPercent } from '../utils/format'
import type { Tone } from '../utils/labels'

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string
  description?: ReactNode
  actions?: ReactNode
}) {
  return (
    <header className="page-header">
      <div>
        <h1 className="page-title">{title}</h1>
        {description && <p className="page-description">{description}</p>}
      </div>
      {actions && <div className="page-actions">{actions}</div>}
    </header>
  )
}

export function Panel({
  title,
  subtitle,
  actions,
  children,
  className = '',
}: {
  title?: ReactNode
  subtitle?: ReactNode
  actions?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <section className={`panel ${className}`}>
      {(title || actions) && (
        <div className="panel-header">
          <div>
            {title && <h2 className="panel-title">{title}</h2>}
            {subtitle && <p className="panel-subtitle">{subtitle}</p>}
          </div>
          {actions}
        </div>
      )}
      <div className="panel-body">{children}</div>
    </section>
  )
}

export function Badge({ tone = 'neutral', dot = false, children }: { tone?: Tone; dot?: boolean; children: ReactNode }) {
  return <span className={`badge tone-${tone}${dot ? ' badge-dot' : ''}`}>{children}</span>
}

/** Önceki döneme göre değişim: ▲ yeşil, ▼ kırmızı. */
export function Change({ value, digits = 0 }: { value: number | null; digits?: number }) {
  if (value === null) return <span className="change flat">yeni</span>
  const direction = Math.abs(value) < 0.005 ? 'flat' : value > 0 ? 'up' : 'down'
  const arrow = direction === 'up' ? '▲' : direction === 'down' ? '▼' : '■'
  return (
    <span className={`change ${direction}`}>
      {arrow} {formatPercent(Math.abs(value), { digits })}
    </span>
  )
}

export interface SegmentedOption<T extends string> {
  value: T
  label: string
}

export function Segmented<T extends string>({
  options,
  value,
  onChange,
  label,
}: {
  options: SegmentedOption<T>[]
  value: T
  onChange: (value: T) => void
  label: string
}) {
  return (
    <div className="segmented" role="group" aria-label={label}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={option.value === value}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}

export interface ChipOption<T extends string> {
  value: T
  label: string
  count?: number
}

export function ChipFilter<T extends string>({
  options,
  value,
  onChange,
  label,
}: {
  options: ChipOption<T>[]
  value: T
  onChange: (value: T) => void
  label: string
}) {
  return (
    <div className="chips" role="group" aria-label={label}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          className="chip"
          aria-pressed={option.value === value}
          onClick={() => onChange(option.value)}
        >
          {option.label}
          {option.count !== undefined && <span className="count">{option.count}</span>}
        </button>
      ))}
    </div>
  )
}
