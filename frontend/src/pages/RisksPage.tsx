import { useState } from 'react'
import { getRisks, getThresholds } from '../api'
import { RiskCard } from '../components/RiskCard'
import { AsyncContent, EmptyState } from '../components/states'
import { Badge, ChipFilter, PageHeader, Panel, Segmented } from '../components/ui'
import { useApi } from '../hooks/useApi'
import type { Risk, RiskSignal } from '../types'
import { formatCurrency, formatMonths, formatNumber, formatPercent } from '../utils/format'
import { SEVERITY_LABELS, SIGNAL_LABELS } from '../utils/labels'

type SignalFilter = 'all' | RiskSignal
type View = 'cards' | 'table'

export default function RisksPage() {
  const risks = useApi(getRisks)
  const thresholds = useApi(getThresholds)
  const [filter, setFilter] = useState<SignalFilter>('all')
  const [view, setView] = useState<View>('cards')

  const t = thresholds.data
  const description = t
    ? `Son 30 gün satışı %${formatNumber(t.RISK_DECLINE_THRESHOLD * 100)} veya daha fazla düşen, stoğu ${t.HIGH_STOCK_MONTHS} aydan uzun yeten ya da ${formatNumber(t.LOW_STOCK_MONTHS, 1)} aydan kısa sürede bitecek ürünler.`
    : 'Satış düşüşü, fazla stok ve tükenme riski taşıyan ürünler.'

  return (
    <>
      <PageHeader
        title="Risk Tespiti"
        description={description}
        actions={
          <Segmented
            label="Görünüm"
            value={view}
            onChange={setView}
            options={[
              { value: 'cards', label: 'Kart' },
              { value: 'table', label: 'Liste' },
            ]}
          />
        }
      />

      <AsyncContent state={risks}>
        {(data) => {
          const count = (signal: RiskSignal) => data.items.filter((r) => r.signals.includes(signal)).length
          const items = data.items.filter((r) => filter === 'all' || r.signals.includes(filter))

          return (
            <div className="stack">
              <ChipFilter
                label="Risk türüne göre filtrele"
                value={filter}
                onChange={setFilter}
                options={[
                  { value: 'all', label: 'Tümü', count: data.count },
                  { value: 'sales_decline', label: SIGNAL_LABELS.sales_decline, count: count('sales_decline') },
                  { value: 'overstock', label: SIGNAL_LABELS.overstock, count: count('overstock') },
                  { value: 'stockout', label: SIGNAL_LABELS.stockout, count: count('stockout') },
                ]}
              />

              {items.length === 0 ? (
                <Panel>
                  <EmptyState
                    title={data.count === 0 ? 'Risk tespit edilmedi' : 'Bu filtreye uyan risk yok'}
                    description={data.count === 0 ? 'Tüm ürünler eşik değerlerin içinde.' : undefined}
                  />
                </Panel>
              ) : view === 'cards' ? (
                <div className="grid grid-cards">
                  {items.map((risk) => (
                    <RiskCard key={risk.id} risk={risk} />
                  ))}
                </div>
              ) : (
                <Panel>
                  <RiskTable risks={items} />
                </Panel>
              )}
            </div>
          )
        }}
      </AsyncContent>
    </>
  )
}

function RiskTable({ risks }: { risks: Risk[] }) {
  return (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr>
            <th>Ürün</th>
            <th>Sinyaller</th>
            <th className="num">Satış değişimi</th>
            <th className="num">Stok</th>
            <th className="num">Stok yeterliliği</th>
            <th>Öneri</th>
            <th className="num">Etki</th>
          </tr>
        </thead>
        <tbody>
          {risks.map((risk) => (
            <tr key={risk.id}>
              <td>
                {risk.product.name}
                <div className="cell-sub">{SEVERITY_LABELS[risk.severity]}</div>
              </td>
              <td>
                <div className="insight-badges">
                  {risk.signals.map((s) => (
                    <Badge key={s} tone={s === 'overstock' ? 'warning' : 'risk'}>
                      {SIGNAL_LABELS[s]}
                    </Badge>
                  ))}
                </div>
              </td>
              <td className="num">
                {risk.metrics.salesChangePct === null ? '—' : formatPercent(risk.metrics.salesChangePct, { signed: true })}
              </td>
              <td className="num">{risk.metrics.stockUnits === null ? '—' : formatNumber(risk.metrics.stockUnits)}</td>
              <td className="num">{formatMonths(risk.metrics.monthsOfStock)}</td>
              <td style={{ minWidth: 280 }} className="muted">
                {risk.recommendation}
              </td>
              <td className="num">{formatCurrency(risk.impactAmount)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
