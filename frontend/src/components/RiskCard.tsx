import type { Risk } from '../types'
import { formatMonths, formatNumber, formatPercent } from '../utils/format'
import { SIGNAL_LABELS } from '../utils/labels'
import { InsightCard } from './InsightCard'
import { Badge } from './ui'

export function RiskCard({ risk }: { risk: Risk }) {
  const { metrics, signals, product } = risk
  const declined = signals.includes('sales_decline')
  const stockSignal = signals.includes('overstock') || signals.includes('stockout')

  return (
    <InsightCard
      insight={risk}
      tone="risk"
      title={product.name}
      subtitle={`${product.sku} · ${product.category}`}
      badges={signals.map((signal) => (
        <Badge key={signal} tone={signal === 'overstock' ? 'warning' : 'risk'}>
          {SIGNAL_LABELS[signal]}
        </Badge>
      ))}
      metrics={[
        {
          label: 'Satış değişimi (30g)',
          value: metrics.salesChangePct === null ? '—' : formatPercent(metrics.salesChangePct, { signed: true }),
          emphasize: declined,
        },
        { label: 'Stok yeterliliği', value: formatMonths(metrics.monthsOfStock), emphasize: stockSignal },
        { label: 'Mevcut stok', value: metrics.stockUnits === null ? 'Girilmemiş' : `${formatNumber(metrics.stockUnits)} adet` },
      ]}
    />
  )
}
