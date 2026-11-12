import type { Opportunity } from '../types'
import { formatMonths, formatNumber, formatPercent } from '../utils/format'
import { InsightCard } from './InsightCard'
import { Badge } from './ui'

export function OpportunityCard({ opportunity }: { opportunity: Opportunity }) {
  const { metrics, product, region } = opportunity
  const transfer = metrics.transfer

  return (
    <InsightCard
      insight={opportunity}
      tone="opportunity"
      title={`${product.name} · ${region.name}`}
      subtitle={`${product.sku} · ${product.category}`}
      badges={<Badge tone="opportunity">Fırsat</Badge>}
      metrics={[
        { label: 'Satış artışı (3 hafta)', value: formatPercent(metrics.growthPct, { signed: true }), emphasize: true },
        { label: 'Bölge stoğu', value: formatMonths(metrics.regionMonthsOfStock) },
        {
          label: 'Transfer önerisi',
          value: transfer ? `+${formatNumber(transfer.units)} adet` : '—',
          emphasize: Boolean(transfer),
        },
      ]}
    />
  )
}
