import { useState } from 'react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { getSalesAnalytics } from '../api'
import { tooltipStyles } from '../components/ChartTooltip'
import { StatCard, StatGridSkeleton } from '../components/StatCard'
import { AsyncContent, EmptyState } from '../components/states'
import { Badge, Change, PageHeader, Panel, Segmented } from '../components/ui'
import { useApi } from '../hooks/useApi'
import { useTheme } from '../theme'
import type { Margin, SalesAnalytics } from '../types'
import {
  formatCompactCurrency,
  formatCurrency,
  formatDate,
  formatNumber,
  formatPercent,
  formatShortDate,
} from '../utils/format'
import { MARGIN_STATUS_LABELS, MARGIN_STATUS_TONES } from '../utils/labels'

type Group = 'product' | 'region'

interface ComparisonRow {
  key: number
  label: string
  sub?: string
  current: number
  previous: number
  delta: number
  changePct: number | null
  currentUnits?: number
  previousUnits?: number
}

function toRows(data: SalesAnalytics, group: Group): ComparisonRow[] {
  const rows: ComparisonRow[] =
    group === 'product'
      ? data.products.map((p) => ({
          key: p.product.id,
          label: p.product.name,
          sub: p.product.category,
          current: p.currentRevenue,
          previous: p.previousRevenue,
          delta: p.revenueDelta,
          changePct: p.revenueChangePct,
          currentUnits: p.currentUnits,
          previousUnits: p.previousUnits,
        }))
      : data.regions.map((r) => ({
          key: r.region.id,
          label: r.region.name,
          sub: `${r.currentOrders} sipariş`,
          current: r.currentRevenue,
          previous: r.previousRevenue,
          delta: r.revenueDelta,
          changePct: r.revenueChangePct,
        }))
  return rows.sort((a, b) => b.current - a.current)
}

export default function SalesPage() {
  const state = useApi(getSalesAnalytics)
  const [group, setGroup] = useState<Group>('product')

  return (
    <>
      <PageHeader
        title="Satış Analizi"
        description="Ürün ve bölge bazında son 30 gün ile önceki 30 günün karşılaştırması ve ciro değişiminin nedenleri."
      />

      <AsyncContent state={state} skeleton={<StatGridSkeleton count={4} />}>
        {(data) => (
          <div className="stack">
            <SalesKpis data={data} />
            <ExplanationCallout data={data} />

            <Panel
              title="Son 30 gün vs önceki 30 gün"
              subtitle={`${formatDate(data.windows.current.from)} – ${formatDate(data.windows.current.to)} dönemi, bir önceki 30 günle`}
              actions={
                <Segmented
                  label="Gruplama"
                  value={group}
                  onChange={setGroup}
                  options={[
                    { value: 'product', label: 'Ürün' },
                    { value: 'region', label: 'Bölge' },
                  ]}
                />
              }
            >
              <ComparisonChart rows={toRows(data, group)} />
            </Panel>

            <div className="grid grid-2">
              <Panel title="Haftalık ciro trendi" subtitle="Son 26 hafta">
                <WeeklyTrendChart data={data} />
              </Panel>
              <Panel title={group === 'product' ? 'Ürün bazında değişim' : 'Bölge bazında değişim'} subtitle="Ciro etkisine göre">
                <ComparisonTable rows={toRows(data, group)} group={group} />
              </Panel>
            </div>

            <Panel title="Marj analizi" subtitle="Son 90 gün · gerçekleşen ortalama satış fiyatı ile birim maliyet karşılaştırması">
              <MarginTable margins={data.margins} />
            </Panel>
          </div>
        )}
      </AsyncContent>
    </>
  )
}

function SalesKpis({ data }: { data: SalesAnalytics }) {
  const { current, previous } = data.totals
  const change = (a: number, b: number) => (b === 0 ? null : (a - b) / b)
  return (
    <div className="grid grid-kpi">
      <StatCard label="Ciro (30 gün)" value={formatCompactCurrency(current.revenue)} change={change(current.revenue, previous.revenue)} hint={`önceki: ${formatCompactCurrency(previous.revenue)}`} tone="accent" />
      <StatCard label="Satılan adet" value={formatNumber(current.units)} change={change(current.units, previous.units)} tone="accent" />
      <StatCard label="Ortalama sipariş değeri" value={formatCompactCurrency(current.avgOrderValue)} change={change(current.avgOrderValue, previous.avgOrderValue)} tone="accent" />
      {current.grossProfit === null || current.grossMarginPct === null ? (
        <StatCard label="Brüt kâr (30 gün)" value="—" hint="ürün maliyetleri girilmemiş" tone="accent" />
      ) : (
        <StatCard
          label="Brüt kâr (30 gün)"
          value={formatCompactCurrency(current.grossProfit)}
          change={previous.grossProfit === null ? undefined : change(current.grossProfit, previous.grossProfit)}
          hint={`marj ${formatPercent(current.grossMarginPct, { digits: 1 })}${current.costCoverage < 0.99 ? ` · cironun ${formatPercent(current.costCoverage)} kadarı` : ''}`}
          tone="accent"
        />
      )}
    </div>
  )
}

function ExplanationCallout({ data }: { data: SalesAnalytics }) {
  const { explanation } = data
  const tone = explanation.direction === 'down' ? 'risk' : explanation.direction === 'up' ? 'opportunity' : 'accent'
  return (
    <div className={`callout tone-${tone}`}>
      <div>
        <div className="callout-title">Ciro neden değişti?</div>
        <div style={{ marginTop: 2 }}>{explanation.summary}</div>
        <ul className="bullets">
          {explanation.bullets.map((bullet) => (
            <li key={bullet}>{bullet}</li>
          ))}
        </ul>
      </div>
    </div>
  )
}

function ComparisonChart({ rows }: { rows: ComparisonRow[] }) {
  const { chart } = useTheme()
  const tooltip = tooltipStyles(chart)
  const height = Math.max(220, rows.length * 38 + 48)

  if (rows.length === 0) return <EmptyState title="Bu dönemde satış yok" />

  return (
    <ResponsiveContainer width="100%" height={height} initialDimension={{ width: 800, height }}>
      <BarChart data={rows} layout="vertical" margin={{ top: 4, right: 16, left: 8, bottom: 4 }} barGap={2} barCategoryGap={8}>
        <CartesianGrid stroke={chart.grid} horizontal={false} />
        <XAxis
          type="number"
          tickFormatter={(v: number) => formatCompactCurrency(v)}
          stroke={chart.axis}
          tick={{ fontSize: 12 }}
          tickLine={false}
          axisLine={false}
        />
        <YAxis
          type="category"
          dataKey="label"
          width={170}
          stroke={chart.axis}
          tick={{ fontSize: 12.5, fill: chart.text }}
          tickLine={false}
          axisLine={false}
        />
        <Tooltip
          {...tooltip}
          cursor={{ fill: chart.grid, opacity: 0.5 }}
          formatter={(value, name) => [formatCurrency(Number(value)), name]}
        />
        <Legend wrapperStyle={{ fontSize: 12.5, color: chart.axis }} />
        <Bar dataKey="current" name="Son 30 gün" fill={chart.current} radius={[0, 4, 4, 0]} />
        <Bar dataKey="previous" name="Önceki 30 gün" fill={chart.previous} radius={[0, 4, 4, 0]} />
      </BarChart>
    </ResponsiveContainer>
  )
}

function WeeklyTrendChart({ data }: { data: SalesAnalytics }) {
  const { chart } = useTheme()
  const tooltip = tooltipStyles(chart)
  return (
    <ResponsiveContainer width="100%" height={300} initialDimension={{ width: 600, height: 300 }}>
      <LineChart data={data.weeklyTrend} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid stroke={chart.grid} vertical={false} />
        <XAxis dataKey="weekEnd" tickFormatter={formatShortDate} stroke={chart.axis} tick={{ fontSize: 12 }} tickLine={false} axisLine={false} minTickGap={24} />
        <YAxis tickFormatter={(v: number) => formatCompactCurrency(v)} stroke={chart.axis} tick={{ fontSize: 12 }} tickLine={false} axisLine={false} width={72} />
        <Tooltip
          {...tooltip}
          labelFormatter={(label) => `Hafta sonu: ${formatDate(String(label))}`}
          formatter={(value) => [formatCurrency(Number(value)), 'Ciro']}
        />
        <Line type="monotone" dataKey="revenue" stroke={chart.current} strokeWidth={2} dot={false} activeDot={{ r: 4 }} />
      </LineChart>
    </ResponsiveContainer>
  )
}

function ComparisonTable({ rows, group }: { rows: ComparisonRow[]; group: Group }) {
  const sorted = [...rows].sort((a, b) => a.delta - b.delta)
  return (
    <div className="table-wrap" style={{ maxHeight: 300, overflowY: 'auto' }}>
      <table className="table">
        <thead>
          <tr>
            <th>{group === 'product' ? 'Ürün' : 'Bölge'}</th>
            {group === 'product' && <th className="num">Adet</th>}
            <th className="num">Ciro etkisi</th>
            <th className="num">Değişim</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((row) => (
            <tr key={row.key}>
              <td>
                {row.label}
                {row.sub && <div className="cell-sub">{row.sub}</div>}
              </td>
              {group === 'product' && (
                <td className="num">
                  {formatNumber(row.previousUnits ?? 0)} → {formatNumber(row.currentUnits ?? 0)}
                </td>
              )}
              <td className="num" style={{ color: row.delta < 0 ? 'var(--risk)' : 'var(--opportunity)' }}>
                {row.delta > 0 ? '+' : row.delta < 0 ? '−' : ''}
                {formatCompactCurrency(Math.abs(row.delta))}
              </td>
              <td className="num">
                <Change value={row.changePct} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function MarginTable({ margins }: { margins: Margin[] }) {
  if (margins.length === 0) return <EmptyState title="Marj hesaplanacak satış yok" />
  return (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr>
            <th>Ürün</th>
            <th className="num">Liste fiyatı</th>
            <th className="num">Ort. satış fiyatı</th>
            <th className="num">Ort. iskonto</th>
            <th className="num">Birim maliyet</th>
            <th className="num">Marj</th>
            <th className="num">Brüt kâr</th>
            <th>Durum</th>
          </tr>
        </thead>
        <tbody>
          {margins.map((m) => (
            <tr key={m.product.id}>
              <td>
                {m.product.name}
                <div className="cell-sub">{formatNumber(m.unitsSold)} adet</div>
              </td>
              <td className="num">{formatCurrency(m.listPrice)}</td>
              <td className="num">{formatCurrency(m.avgSellingPrice)}</td>
              <td className="num">{formatPercent(m.avgDiscountPct, { digits: 1 })}</td>
              <td className="num">{formatCurrency(m.unitCost)}</td>
              <td className="num" style={{ fontWeight: 600, color: m.status === 'healthy' ? undefined : `var(--${m.status === 'loss' ? 'risk' : 'warning'})` }}>
                {formatPercent(m.marginPct, { digits: 1 })}
              </td>
              <td className="num">{formatCompactCurrency(m.grossProfit)}</td>
              <td>
                <Badge tone={MARGIN_STATUS_TONES[m.status]} dot>
                  {MARGIN_STATUS_LABELS[m.status]}
                </Badge>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
