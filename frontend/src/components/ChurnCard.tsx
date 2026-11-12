import type { ChurnRisk } from '../types'
import { formatDate, formatNumber } from '../utils/format'
import { InsightCard } from './InsightCard'
import { Badge } from './ui'

export function ChurnCard({ churn }: { churn: ChurnRisk }) {
  const { metrics, customer } = churn

  return (
    <InsightCard
      insight={churn}
      tone="churn"
      title={customer.name}
      subtitle={`${customer.type} · ${customer.region.name}${customer.salesRepName ? ` · ${customer.salesRepName}` : ''}`}
      badges={<Badge tone="churn">Kayıp riski</Badge>}
      metrics={[
        { label: 'Sessizlik', value: `${metrics.daysSinceLastOrder} gün`, emphasize: true },
        { label: 'Tipik aralık', value: `${formatNumber(metrics.medianIntervalDays)} gün` },
        { label: 'Son sipariş', value: formatDate(metrics.lastOrderDate) },
      ]}
    />
  )
}
