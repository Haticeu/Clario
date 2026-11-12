import { useState } from 'react'
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts'
import { getCustomerAnalysis } from '../api'
import { tooltipStyles } from '../components/ChartTooltip'
import { ChurnCard } from '../components/ChurnCard'
import { StatCard, StatGridSkeleton } from '../components/StatCard'
import { AsyncContent, EmptyState } from '../components/states'
import { Badge, ChipFilter, PageHeader, Panel } from '../components/ui'
import { useApi } from '../hooks/useApi'
import { useTheme } from '../theme'
import type { CustomerAnalysis, CustomerStatus, SegmentSummary } from '../types'
import { formatCompactCurrency, formatCurrency, formatDate, formatNumber, formatPercent } from '../utils/format'
import { CUSTOMER_STATUS_LABELS, CUSTOMER_STATUS_TONES } from '../utils/labels'

type StatusFilter = 'all' | CustomerStatus

export default function CustomersPage() {
  const state = useApi(getCustomerAnalysis)

  return (
    <>
      <PageHeader
        title="Müşteri Analizi"
        description="Her müşterinin kendi sipariş ritmine göre kayıp riski ve ciroya göre ABC segment dağılımı."
      />
      <AsyncContent state={state} skeleton={<StatGridSkeleton count={4} />}>
        {(data) => <CustomersContent data={data} />}
      </AsyncContent>
    </>
  )
}

function CustomersContent({ data }: { data: CustomerAnalysis }) {
  const [filter, setFilter] = useState<StatusFilter>('all')
  const { summary, thresholds } = data
  const customers = data.customers.filter((c) => filter === 'all' || c.status === filter)

  return (
    <div className="stack">
      <div className="grid grid-kpi">
        <StatCard label="Toplam müşteri" value={summary.totalCustomers} hint={data.byType.map((t) => `${t.customerCount} ${t.type.toLowerCase()}`).join(' · ')} tone="accent" />
        <StatCard label="Aktif (son 30 gün)" value={summary.activeCustomers} hint="sipariş veren müşteri" tone="accent" />
        <StatCard label="Kayıp riski" value={summary.churnRisk} hint={`izlemede: ${summary.watch}`} tone="churn" />
        <StatCard label="Risk altındaki aylık ciro" value={formatCompactCurrency(summary.monthlyRevenueAtRisk)} tone="risk" />
      </div>

      <div className="grid grid-sidebar">
        <Panel
          title="Kayıp riski taşıyan müşteriler"
          subtitle={`Kendi medyan sipariş aralığının ${formatNumber(thresholds.churnSilenceMultiplier, 1)} katından uzun süredir sipariş vermeyenler`}
        >
          {data.churnRisks.length === 0 ? (
            <EmptyState title="Kayıp riski taşıyan müşteri yok" description="Tüm müşteriler kendi sipariş ritimlerinde." />
          ) : (
            <div className="stack" style={{ gap: 14 }}>
              {data.churnRisks.map((churn) => (
                <ChurnCard key={churn.id} churn={churn} />
              ))}
            </div>
          )}
        </Panel>

        <Panel title="Segment dağılımı" subtitle="ABC analizi · cironun ilk %80'i A segmenti">
          <SegmentDonut segments={data.segments} />
        </Panel>
      </div>

      <Panel
        title="Müşteri listesi"
        subtitle="Sessizlik oranına göre sıralı (sessizlik süresi ÷ tipik sipariş aralığı)"
        actions={
          <ChipFilter
            label="Duruma göre filtrele"
            value={filter}
            onChange={setFilter}
            options={[
              { value: 'all', label: 'Tümü', count: summary.totalCustomers },
              { value: 'churn_risk', label: 'Kayıp riski', count: summary.churnRisk },
              { value: 'watch', label: 'İzlemede', count: summary.watch },
              { value: 'active', label: 'Aktif', count: summary.active },
            ]}
          />
        }
      >
        {customers.length === 0 ? (
          <EmptyState title="Bu filtreye uyan müşteri yok" />
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Müşteri</th>
                  <th>Segment</th>
                  <th className="num">Sipariş</th>
                  <th className="num">Tipik aralık</th>
                  <th className="num">Son sipariş</th>
                  <th className="num">Sessizlik</th>
                  <th className="num">Toplam ciro</th>
                  <th>Durum</th>
                </tr>
              </thead>
              <tbody>
                {customers.map((c) => (
                  <tr key={c.customer.id}>
                    <td>
                      {c.customer.name}
                      <div className="cell-sub">
                        {c.customer.type} · {c.customer.region.name}
                      </div>
                    </td>
                    <td>{c.segment}</td>
                    <td className="num">{c.orderCount}</td>
                    <td className="num">{c.medianIntervalDays === null ? '—' : `${formatNumber(c.medianIntervalDays)} gün`}</td>
                    <td className="num">{c.lastOrderDate ? formatDate(c.lastOrderDate) : '—'}</td>
                    <td className="num">
                      {c.daysSinceLastOrder === null ? '—' : `${c.daysSinceLastOrder} gün`}
                      {c.silenceRatio !== null && <div className="cell-sub">{formatNumber(c.silenceRatio, 1)}×</div>}
                    </td>
                    <td className="num">{formatCompactCurrency(c.totalRevenue)}</td>
                    <td>
                      <Badge tone={CUSTOMER_STATUS_TONES[c.status]} dot>
                        {CUSTOMER_STATUS_LABELS[c.status]}
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

function SegmentDonut({ segments }: { segments: SegmentSummary[] }) {
  const { chart } = useTheme()
  const tooltip = tooltipStyles(chart)
  const data = segments.filter((s) => s.revenue > 0)

  if (data.length === 0) return <EmptyState title="Segment verisi yok" />

  return (
    <div className="stack" style={{ gap: 12 }}>
      <ResponsiveContainer width="100%" height={220} initialDimension={{ width: 320, height: 220 }}>
        <PieChart>
          <Pie data={data} dataKey="revenue" nameKey="label" innerRadius={62} outerRadius={95} paddingAngle={2} stroke="none">
            {data.map((segment, i) => (
              <Cell key={segment.segment} fill={chart.segments[i % chart.segments.length]} />
            ))}
          </Pie>
          <Tooltip {...tooltip} formatter={(value, name) => [formatCurrency(Number(value)), name]} />
        </PieChart>
      </ResponsiveContainer>

      <div className="donut-legend">
        {data.map((segment, i) => (
          <div key={segment.segment} className="donut-legend-row">
            <span className="legend-dot" style={{ background: chart.segments[i % chart.segments.length] }} />
            <span>
              {segment.label}
              <div className="cell-sub">
                {segment.customerCount} müşteri
                {segment.churnRiskCount > 0 && ` · ${segment.churnRiskCount} kayıp riski`}
              </div>
            </span>
            <b>{formatPercent(segment.revenueShare)}</b>
          </div>
        ))}
      </div>
    </div>
  )
}
