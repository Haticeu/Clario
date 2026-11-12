import { Link } from 'react-router'
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { getDashboardSummary, getOpportunities, getRisks } from '../api'
import { tooltipStyles } from '../components/ChartTooltip'
import { InsightList } from '../components/InsightList'
import { NewsPanel } from '../components/news/NewsPanel'
import { StatCard, StatGridSkeleton } from '../components/StatCard'
import { AsyncContent, EmptyState, LoadingState, NoDataState } from '../components/states'
import { Badge, PageHeader, Panel } from '../components/ui'
import { useApi } from '../hooks/useApi'
import { useTheme } from '../theme'
import type { DashboardSummary, WeeklyPoint } from '../types'
import {
  formatCompactCurrency,
  formatCurrency,
  formatDate,
  formatNumber,
  formatPercent,
  formatShortDate,
} from '../utils/format'
import { KIND_LABELS, KIND_TONES, PRIORITY_LABELS, PRIORITY_TONES } from '../utils/labels'

const SUMMARY_LIMIT = 3

export default function DashboardPage() {
  const summary = useApi(getDashboardSummary)
  // Riskler ve fırsatlar birbirinden bağımsız; biri hata verirse diğer bölümler çalışmaya devam eder.
  const risks = useApi(getRisks)
  const opportunities = useApi(getOpportunities)

  // Henüz hiç satış yoksa tek bir karşılama kartı göster (her bölümde ayrı "veri yok" yerine)
  if (summary.error?.status === 503) {
    return (
      <>
        <PageHeader title="Clario'ya hoş geldiniz" description="İşletme verilerinizi girdiğinizde riskler, fırsatlar ve öneriler burada otomatik olarak oluşur." />
        <div className="stack">
          <NoDataState description="Başlamak için satışlarınızı, ürünlerinizi ve müşterilerinizi ekleyin. En hızlısı: Excel şablonunu indirip doldurmak ve tek seferde yüklemek. Risk ve fırsat analizleri en az 2–3 aylık satış geçmişiyle anlamlı sonuç verir." />
          <NewsPanel />
        </div>
      </>
    )
  }

  return (
    <>
      <PageHeader
        title="Genel Bakış"
        description={
          summary.data
            ? `Son 30 günün özeti (${formatDate(summary.data.windows.current.from)} – ${formatDate(summary.data.asOf)}), önceki 30 günle karşılaştırmalı.`
            : 'Son 30 günün özeti, önceki 30 günle karşılaştırmalı.'
        }
      />

      <div className="stack">
        <AsyncContent state={summary} skeleton={<StatGridSkeleton count={8} />}>
          {(data) => <KpiGrid data={data} />}
        </AsyncContent>

        <div className="grid grid-sidebar">
          <Panel title="Haftalık ciro" subtitle="Son 26 hafta">
            <AsyncContent state={summary} skeleton={<div className="skeleton" style={{ height: 260 }} />}>
              {(data) => <RevenueTrend points={data.revenueTrend} />}
            </AsyncContent>
          </Panel>

          <Panel
            title="Öncelikli aksiyonlar"
            subtitle="Etkiye göre sıralı"
            actions={<Link to="/recommendations" className="muted">Tümü →</Link>}
          >
            <AsyncContent state={summary} skeleton={<LoadingState rows={2} />}>
              {(data) =>
                data.topRecommendations.length === 0 ? (
                  <EmptyState title="Açık aksiyon yok" />
                ) : (
                  <div className="mini-list">
                    {data.topRecommendations.slice(0, 4).map((rec) => (
                      <div key={rec.id} className={`mini-item tone-${PRIORITY_TONES[rec.priority]}`}>
                        <span className="mini-bar" />
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div className="mini-title">{rec.title}</div>
                          <div className="insight-badges" style={{ marginTop: 4 }}>
                            <Badge tone={PRIORITY_TONES[rec.priority]}>{PRIORITY_LABELS[rec.priority]}</Badge>
                            <Badge tone={KIND_TONES[rec.source]}>{KIND_LABELS[rec.source]}</Badge>
                          </div>
                        </div>
                        <span className="faint nowrap" style={{ fontSize: 12.5 }}>
                          {formatCompactCurrency(rec.impactAmount)}
                        </span>
                      </div>
                    ))}
                  </div>
                )
              }
            </AsyncContent>
          </Panel>
        </div>

        {summary.data && (
          <div className="callout tone-accent">
            <div>
              <div className="callout-title">Ciro özeti</div>
              <div className="muted" style={{ fontSize: 13.5 }}>
                {summary.data.salesSummary} Ayrıntılı açıklama için <Link to="/sales">Satış Analizi</Link>.
              </div>
            </div>
          </div>
        )}

        <NewsPanel />

        <div className="grid grid-2">
          <Panel
            title="Son riskler"
            subtitle="Satış düşüşü ve stok dengesizlikleri"
            actions={<Link to="/risks" className="muted">Tümü →</Link>}
          >
            <AsyncContent state={risks} skeleton={<LoadingState rows={2} />}>
              {(data) =>
                data.items.length === 0 ? (
                  <EmptyState title="Risk tespit edilmedi" description="Tüm ürünler eşik değerlerin içinde." />
                ) : (
                  <InsightList items={data.items.slice(0, SUMMARY_LIMIT)} />
                )
              }
            </AsyncContent>
          </Panel>

          <Panel title="Fırsatlar" subtitle="Son 3 haftada anlamlı artış gösteren ürün-bölgeler">
            <AsyncContent state={opportunities} skeleton={<LoadingState rows={2} />}>
              {(data) =>
                data.items.length === 0 ? (
                  <EmptyState title="Fırsat tespit edilmedi" description="Son 3 haftada anlamlı bir artış yok." />
                ) : (
                  <InsightList items={data.items.slice(0, SUMMARY_LIMIT)} />
                )
              }
            </AsyncContent>
          </Panel>
        </div>
      </div>
    </>
  )
}

function KpiGrid({ data }: { data: DashboardSummary }) {
  const { kpis } = data
  return (
    <div className="grid grid-kpi">
      <StatCard label="Ciro (30 gün)" value={formatCompactCurrency(kpis.revenue.current)} change={kpis.revenue.changePct} hint="önceki 30 güne göre" tone="accent" />
      <StatCard label="Sipariş sayısı" value={formatNumber(kpis.orders.current)} change={kpis.orders.changePct} hint={`ort. ${formatCompactCurrency(kpis.avgOrderValue.current)}`} tone="accent" />
      <StatCard label="Aktif müşteri" value={formatNumber(kpis.activeCustomers.current)} change={kpis.activeCustomers.changePct} hint="30 günde sipariş veren" tone="accent" />
      {kpis.estimatedNetProfit === null || kpis.grossProfit.marginPct === null ? (
        <StatCard
          label="Tahmini net kâr (30 gün)"
          value="—"
          hint={<Link to="/data?tab=products">Kâr için ürün maliyetlerini girin →</Link>}
          tone="neutral"
        />
      ) : (
        <StatCard
          label="Tahmini net kâr (30 gün)"
          value={formatCompactCurrency(kpis.estimatedNetProfit)}
          hint={
            `brüt marj ${formatPercent(kpis.grossProfit.marginPct, { digits: 1 })} · gider ${formatCompactCurrency(kpis.monthlyExpenses.average)}/ay` +
            (kpis.grossProfit.costCoverage < 0.99 ? ` · maliyeti bilinen ürünlerle (cironun ${formatPercent(kpis.grossProfit.costCoverage)})` : '')
          }
          tone={kpis.estimatedNetProfit >= 0 ? 'neutral' : 'risk'}
        />
      )}
      <StatCard label="Açık risk" value={kpis.openRisks} hint="ürün" tone="risk" />
      <StatCard label="Fırsat" value={kpis.opportunities} hint="ürün-bölge" tone="opportunity" />
      <StatCard label="Kayıp riski" value={kpis.churnRisks} hint="müşteri" tone="churn" />
      <StatCard label="Yüksek öncelikli aksiyon" value={kpis.highPriorityActions} hint="etkisi cironun ≥%3'ü" tone="warning" />
    </div>
  )
}

function RevenueTrend({ points }: { points: WeeklyPoint[] }) {
  const { chart } = useTheme()
  const tooltip = tooltipStyles(chart)

  return (
    <ResponsiveContainer width="100%" height={260} initialDimension={{ width: 600, height: 260 }}>
      <AreaChart data={points} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <defs>
          <linearGradient id="revenueFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={chart.current} stopOpacity={0.35} />
            <stop offset="100%" stopColor={chart.current} stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid stroke={chart.grid} vertical={false} />
        <XAxis
          dataKey="weekEnd"
          tickFormatter={formatShortDate}
          stroke={chart.axis}
          tick={{ fontSize: 12 }}
          tickLine={false}
          axisLine={false}
          minTickGap={24}
        />
        <YAxis
          tickFormatter={(v: number) => formatCompactCurrency(v)}
          stroke={chart.axis}
          tick={{ fontSize: 12 }}
          tickLine={false}
          axisLine={false}
          width={72}
        />
        <Tooltip
          {...tooltip}
          labelFormatter={(label) => `Hafta sonu: ${formatDate(String(label))}`}
          formatter={(value) => [formatCurrency(Number(value)), 'Ciro']}
        />
        <Area type="monotone" dataKey="revenue" stroke={chart.current} strokeWidth={2} fill="url(#revenueFill)" />
      </AreaChart>
    </ResponsiveContainer>
  )
}
