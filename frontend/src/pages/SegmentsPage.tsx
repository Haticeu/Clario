import { useState } from 'react'
import { Link } from 'react-router'
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { getSegments } from '../api'
import { tooltipStyles } from '../components/ChartTooltip'
import { StatCard, StatGridSkeleton } from '../components/StatCard'
import { AsyncContent, EmptyState } from '../components/states'
import { Badge, Change, PageHeader, Panel, Segmented } from '../components/ui'
import { SegmentsIcon } from '../components/icons'
import { useApi } from '../hooks/useApi'
import { useTheme } from '../theme'
import type { SegmentAnalysis, SegmentDimension, SegmentFigures, SegmentRow } from '../types'
import { formatCompactCurrency, formatCurrency, formatDate, formatPercent } from '../utils/format'

type Period = 'current' | 'allTime'

const UNASSIGNED = 'Atanmamış'
const DIMENSION_KEY = { department: 'departments', project: 'projects' } as const
const NOUN: Record<SegmentDimension, string> = { department: 'departman', project: 'proje' }

const label = (row: SegmentRow) => row.name ?? UNASSIGNED
const figures = (row: SegmentRow, period: Period): SegmentFigures => row[period]

export default function SegmentsPage() {
  const state = useApi(getSegments)
  const [dimension, setDimension] = useState<SegmentDimension>('project')
  const [period, setPeriod] = useState<Period>('current')

  return (
    <>
      <PageHeader
        title="Departman & Proje"
        description="Her departmanın ve projenin getirdiği ciro, ürün maliyeti, giderleri ve net katkısı. Net katkı = ciro − ürün maliyeti − giderler."
        actions={
          <>
            <Segmented
              label="Gruplama"
              value={dimension}
              onChange={setDimension}
              options={[
                { value: 'project', label: 'Projeler' },
                { value: 'department', label: 'Departmanlar' },
              ]}
            />
            <Segmented
              label="Dönem"
              value={period}
              onChange={setPeriod}
              options={[
                { value: 'current', label: 'Son 30 gün' },
                { value: 'allTime', label: 'Tüm zamanlar' },
              ]}
            />
          </>
        }
      />

      <AsyncContent state={state} skeleton={<StatGridSkeleton count={4} />}>
        {(data) => <SegmentsContent data={data} dimension={dimension} period={period} />}
      </AsyncContent>
    </>
  )
}

function SegmentsContent({ data, dimension, period }: { data: SegmentAnalysis; dimension: SegmentDimension; period: Period }) {
  const rows = data[DIMENSION_KEY[dimension]]
  const named = rows.filter((r) => r.name !== null)
  const noun = NOUN[dimension]

  if (named.length === 0) {
    return (
      <Panel>
        <EmptyState
          icon={<SegmentsIcon size={22} />}
          title={`Henüz ${noun} bilgisi girilmemiş`}
          description={
            <>
              Satışlara ve giderlere {noun} yazdığınızda burada her {noun === 'proje' ? 'projenin' : 'departmanın'} kârlılığı görünür.
              Excel'de "{noun === 'proje' ? 'Proje' : 'Departman'}" sütunu eklemeniz yeterli; ya da <Link to="/data?tab=expenses">Giderler</Link> ve{' '}
              <Link to="/data?tab=sales">Satışlar</Link> sekmesinden tek tek atayabilirsiniz.
            </>
          }
        />
      </Panel>
    )
  }

  const total = rows.reduce(
    (acc, row) => {
      const f = figures(row, period)
      return { revenue: acc.revenue + f.revenue, expenses: acc.expenses + f.expenses, net: acc.net + f.net }
    },
    { revenue: 0, expenses: 0, net: 0 },
  )
  const coverage = data.coverage[DIMENSION_KEY[dimension]]
  const alerts = data.alerts.filter((a) => a.dimension === dimension)
  const periodText =
    period === 'current' ? `${formatDate(data.windows.current.from)} – ${formatDate(data.windows.current.to)}` : `${formatDate(data.asOf)} itibarıyla toplam`

  return (
    <div className="stack">
      <div className="grid grid-kpi">
        <StatCard label={`${named.length} ${noun}`} value={formatCompactCurrency(total.revenue)} hint={`toplam ciro · ${period === 'current' ? 'son 30 gün' : 'tüm zamanlar'}`} tone="accent" />
        <StatCard label="Giderler" value={formatCompactCurrency(total.expenses)} hint={`${noun} bazında girilen giderler`} tone="warning" />
        <StatCard label="Net katkı" value={formatCompactCurrency(total.net)} hint="ciro − ürün maliyeti − giderler" tone={total.net >= 0 ? 'opportunity' : 'risk'} />
        <StatCard
          label={`${noun[0]!.toLocaleUpperCase('tr-TR')}${noun.slice(1)} atanmış pay`}
          value={formatPercent(coverage.revenueShare)}
          hint={`cironun · giderlerin ${formatPercent(coverage.expenseShare)} kadarı`}
          tone={coverage.revenueShare < 0.8 ? 'warning' : 'neutral'}
        />
      </div>

      {alerts.length > 0 && (
        <div className="stack" style={{ gap: 10 }}>
          {alerts.map((alert) => (
            <div key={alert.name} className={`callout tone-${alert.severity === 'high' ? 'risk' : 'warning'}`}>
              <div>
                <div className="callout-title">{alert.name}</div>
                <div className="muted" style={{ fontSize: 13.5 }}>
                  {alert.message}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <Panel title={`${noun === 'proje' ? 'Proje' : 'Departman'} bazında net katkı`} subtitle={periodText}>
        <NetChart rows={rows} period={period} />
      </Panel>

      <Panel title="Ayrıntı" subtitle={period === 'current' ? 'Son 30 gün, değişim önceki 30 güne göre' : 'İlk kayıttan bugüne'}>
        <SegmentTable rows={rows} period={period} noun={noun} />
      </Panel>
    </div>
  )
}

function NetChart({ rows, period }: { rows: SegmentRow[]; period: Period }) {
  const { chart } = useTheme()
  const tooltip = tooltipStyles(chart)
  const data = rows.map((row) => ({ label: label(row), net: figures(row, period).net }))
  const height = Math.max(180, data.length * 40 + 40)

  return (
    <ResponsiveContainer width="100%" height={height} initialDimension={{ width: 800, height }}>
      <BarChart data={data} layout="vertical" margin={{ top: 4, right: 16, left: 8, bottom: 4 }}>
        <CartesianGrid stroke={chart.grid} horizontal={false} />
        <XAxis type="number" tickFormatter={(v: number) => formatCompactCurrency(v)} stroke={chart.axis} tick={{ fontSize: 12 }} tickLine={false} axisLine={false} />
        <YAxis type="category" dataKey="label" width={170} stroke={chart.axis} tick={{ fontSize: 12.5, fill: chart.text }} tickLine={false} axisLine={false} />
        <Tooltip {...tooltip} cursor={{ fill: chart.grid, opacity: 0.5 }} formatter={(value) => [formatCurrency(Number(value)), 'Net katkı']} />
        <Bar dataKey="net" radius={[0, 4, 4, 0]}>
          {data.map((d) => (
            <Cell key={d.label} fill={d.net >= 0 ? chart.positive : chart.negative} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  )
}

function SegmentTable({ rows, period, noun }: { rows: SegmentRow[]; period: Period; noun: string }) {
  return (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr>
            <th>{noun === 'proje' ? 'Proje' : 'Departman'}</th>
            <th className="num">Ciro</th>
            {period === 'current' && <th className="num">Değişim</th>}
            <th className="num">Ürün maliyeti</th>
            <th className="num">Giderler</th>
            <th className="num">Net katkı</th>
            <th className="num">Net marj</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const f = figures(row, period)
            return (
              <tr key={label(row)}>
                <td>
                  {row.name ?? <span className="faint">{UNASSIGNED}</span>}
                  <div className="cell-sub">
                    {f.orders} sipariş
                    {f.costCoverage > 0 && f.costCoverage < 0.99 && ' · bazı ürün maliyetleri girilmemiş'}
                  </div>
                </td>
                <td className="num">{formatCurrency(f.revenue)}</td>
                {period === 'current' && (
                  <td className="num">
                    <Change value={row.revenueChangePct} />
                  </td>
                )}
                <td className="num" title={f.revenue > 0 && f.costCoverage === 0 ? 'Ürün maliyetleri girilmemiş' : undefined}>
                  {f.revenue > 0 && f.costCoverage === 0 ? '—' : formatCurrency(f.productCost)}
                </td>
                <td className="num">{formatCurrency(f.expenses)}</td>
                <td className="num" style={{ fontWeight: 600, color: f.net < 0 ? 'var(--risk)' : 'var(--opportunity)' }}>
                  {formatCurrency(f.net)}
                </td>
                <td className="num">
                  {f.revenue > 0 ? (
                    <Badge tone={f.net < 0 ? 'risk' : 'opportunity'}>{formatPercent(f.net / f.revenue, { digits: 1 })}</Badge>
                  ) : (
                    '—'
                  )}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
