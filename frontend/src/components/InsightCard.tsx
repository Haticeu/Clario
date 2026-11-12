import type { ReactNode } from 'react'
import type { Insight } from '../types'
import { formatCurrency } from '../utils/format'
import { SEVERITY_LABELS, type Tone } from '../utils/labels'
import { LightbulbIcon } from './icons'

export interface MetricItem {
  label: string
  value: ReactNode
  /** Değer vurgulanacaksa kartın tonunda gösterilir. */
  emphasize?: boolean
}

/**
 * Risk, fırsat ve kayıp kartlarının ortak iskeleti: başlık → metrikler → durum → öneri → etki.
 * Renk tonu (kırmızı/yeşil/turuncu) sol kenarda ve öneri kutusunda kullanılır.
 */
export function InsightCard({
  insight,
  tone,
  title,
  subtitle,
  badges,
  metrics,
}: {
  insight: Insight
  tone: Tone
  title: ReactNode
  subtitle?: ReactNode
  badges?: ReactNode
  metrics: MetricItem[]
}) {
  return (
    <article className={`panel insight-card tone-${tone}`}>
      <div className="insight-head">
        <div>
          <h3 className="insight-title">{title}</h3>
          {subtitle && <div className="insight-subtitle">{subtitle}</div>}
        </div>
        <div className="insight-badges">{badges}</div>
      </div>

      <div className="metric-row">
        {metrics.map((metric) => (
          <div className="metric" key={metric.label}>
            <div className="metric-label">{metric.label}</div>
            <div className={`metric-value${metric.emphasize ? ' tone-text' : ''}`}>{metric.value}</div>
          </div>
        ))}
      </div>

      <p className="insight-message">{insight.message}</p>

      <div className="recommendation-box">
        <LightbulbIcon size={18} style={{ color: 'var(--tone)', flexShrink: 0, marginTop: 1 }} />
        <div>
          <strong>Öneri: </strong>
          {insight.recommendation}
        </div>
      </div>

      <div className="impact">
        <span>
          {insight.impactLabel}: <b>{formatCurrency(insight.impactAmount)}</b>
        </span>
        <span>{SEVERITY_LABELS[insight.severity]}</span>
      </div>
    </article>
  )
}
