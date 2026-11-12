import type { Insight } from '../types'
import { formatCompactCurrency } from '../utils/format'
import { KIND_TONES } from '../utils/labels'

/** Kompakt tespit listesi: dashboard özetleri ve asistan cevapları için. */
export function InsightList({ items, showAction = true }: { items: Insight[]; showAction?: boolean }) {
  return (
    <div className="mini-list">
      {items.map((item) => (
        <div key={item.id} className={`mini-item tone-${KIND_TONES[item.kind]}`}>
          <span className="mini-bar" />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="mini-title">{item.title}</div>
            <div className="mini-text">{showAction ? item.recommendation : item.message}</div>
          </div>
          <span className="faint nowrap" style={{ fontSize: 12.5 }} title={item.impactLabel}>
            {formatCompactCurrency(item.impactAmount)}
          </span>
        </div>
      ))}
    </div>
  )
}
