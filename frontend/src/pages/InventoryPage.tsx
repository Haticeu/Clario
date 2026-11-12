import { useState } from 'react'
import { getInventoryIntelligence, getOpportunities } from '../api'
import { OpportunityCard } from '../components/OpportunityCard'
import { RiskCard } from '../components/RiskCard'
import { StatCard, StatGridSkeleton } from '../components/StatCard'
import { AsyncContent, EmptyState } from '../components/states'
import { Badge, ChipFilter, PageHeader, Panel } from '../components/ui'
import { useApi } from '../hooks/useApi'
import type { CoverageStatus, InventoryIntelligence } from '../types'
import { formatCompactCurrency, formatMonths, formatNumber } from '../utils/format'
import { COVERAGE_LABELS, COVERAGE_TONES } from '../utils/labels'

type StatusFilter = 'all' | CoverageStatus

export default function InventoryPage() {
  const state = useApi(getInventoryIntelligence)

  return (
    <>
      <PageHeader
        title="Stok Analizi"
        description="Mevcut stok, son 30 günlük satış hızına göre kaç ay yeter? Ürün ve bölge düzeyinde fazla stok ve tükenme uyarıları."
      />
      <AsyncContent state={state} skeleton={<StatGridSkeleton count={4} />}>
        {(data) => <InventoryContent data={data} />}
      </AsyncContent>
    </>
  )
}

/** Bölgesel talep artışları ve bunları karşılamak için önerilen bölgeler arası stok transferleri. */
function TransferOpportunities() {
  const state = useApi(getOpportunities)
  return (
    <Panel title="Stok transfer fırsatları" subtitle="Talebi anlamlı biçimde artan bölgeler ve stok aktarım önerileri">
      <AsyncContent state={state} skeleton={<div className="skeleton" style={{ height: 120 }} />}>
        {(data) =>
          data.items.length === 0 ? (
            <EmptyState title="Transfer gerektiren bir talep artışı yok" />
          ) : (
            <div className="grid grid-cards">
              {data.items.map((opportunity) => (
                <OpportunityCard key={opportunity.id} opportunity={opportunity} />
              ))}
            </div>
          )
        }
      </AsyncContent>
    </Panel>
  )
}

function InventoryContent({ data }: { data: InventoryIntelligence }) {
  const [filter, setFilter] = useState<StatusFilter>('all')
  const { summary, thresholds } = data
  const rows = data.products.filter((row) => filter === 'all' || row.status === filter)

  return (
    <div className="stack">
      <div className="grid grid-kpi">
        <StatCard label="Toplam stok" value={`${formatNumber(summary.totalUnits)} adet`} hint={`${data.products.length} ürün, ${data.regions.length} bölge`} tone="accent" />
        <StatCard label="Stok değeri (maliyet)" value={formatCompactCurrency(summary.totalValue)} tone="accent" />
        <StatCard label="Fazla stokta bağlı sermaye" value={formatCompactCurrency(summary.excessValue)} hint={`hedef: ~${thresholds.targetStockMonths} aylık stok`} tone="warning" />
        <StatCard label="Tükenme riskindeki ürün" value={summary.statusCounts.stockoutRisk} hint={`< ${formatNumber(thresholds.lowStockMonths, 1)} ay`} tone="risk" />
      </div>

      <Panel title="Stok uyarıları" subtitle={`Stok > ${thresholds.highStockMonths} ay (fazla) veya < ${formatNumber(thresholds.lowStockMonths, 1)} ay (tükenme riski)`}>
        {data.alerts.length === 0 ? (
          <EmptyState title="Ürün düzeyinde stok uyarısı yok" description="Tüm ürünlerin stoğu sağlıklı aralıkta." />
        ) : (
          <div className="grid grid-cards">
            {data.alerts.map((risk) => (
              <RiskCard key={risk.id} risk={risk} />
            ))}
          </div>
        )}
      </Panel>

      <TransferOpportunities />

      {data.regionalAlerts.length > 0 && (
        <Panel title="Bölgesel dengesizlikler" subtitle="Ürünün toplamı sağlıklı görünse bile tek bir bölgede oluşan sorunlar">
          <div className="mini-list">
            {data.regionalAlerts.map((alert) => (
              <div key={alert.id} className={`mini-item tone-${COVERAGE_TONES[alert.status]}`}>
                <span className="mini-bar" />
                <div style={{ flex: 1 }}>
                  <div className="mini-title">
                    {alert.product.name} · {alert.region.name}
                  </div>
                  <div className="mini-text">{alert.message}</div>
                </div>
                <Badge tone={COVERAGE_TONES[alert.status]}>{COVERAGE_LABELS[alert.status]}</Badge>
              </div>
            ))}
          </div>
        </Panel>
      )}

      <Panel
        title="Bölge bazlı stok tablosu"
        subtitle="Her hücre: stok adedi ve o bölgenin satış hızına göre kaç ay yettiği"
        actions={
          <ChipFilter
            label="Duruma göre filtrele"
            value={filter}
            onChange={setFilter}
            options={[
              { value: 'all', label: 'Tümü', count: data.products.length },
              { value: 'stockout_risk', label: 'Tükenme riski', count: summary.statusCounts.stockoutRisk },
              { value: 'excess', label: 'Fazla stok', count: summary.statusCounts.excess },
              { value: 'healthy', label: 'Sağlıklı', count: summary.statusCounts.healthy },
            ]}
          />
        }
      >
        {rows.length === 0 ? (
          <EmptyState title="Bu filtreye uyan ürün yok" />
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Ürün</th>
                  {data.regions.map((region) => (
                    <th key={region.id} className="num">
                      {region.name}
                    </th>
                  ))}
                  <th className="num">Toplam</th>
                  <th>Durum</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.product.id}>
                    <td>
                      {row.product.name}
                      <div className="cell-sub">
                        {row.product.sku} · {formatNumber(row.monthlyVelocity)} adet/ay
                      </div>
                    </td>
                    {row.cells.map((cell) => (
                      <td key={cell.regionId} className="num">
                        <span className={`stock-cell tone-${COVERAGE_TONES[cell.status]}`} title={COVERAGE_LABELS[cell.status]}>
                          <b>{cell.stock === null ? '—' : formatNumber(cell.stock)}</b>
                          <span>{cell.stock === null ? 'girilmedi' : formatMonths(cell.monthsOfStock)}</span>
                        </span>
                      </td>
                    ))}
                    <td className="num">
                      <b>{row.totalStock === null ? '—' : formatNumber(row.totalStock)}</b>
                      <div className="cell-sub">{row.totalStock === null ? 'stok girilmedi' : formatMonths(row.monthsOfStock)}</div>
                    </td>
                    <td>
                      <Badge tone={COVERAGE_TONES[row.status]} dot>
                        {COVERAGE_LABELS[row.status]}
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </div>
  )
}
