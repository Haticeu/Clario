import { useState } from 'react'
import { Link, useSearchParams } from 'react-router'
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { getReport, getReportOptions } from '../api'
import { tooltipStyles } from '../components/ChartTooltip'
import { StatCard, StatGridSkeleton } from '../components/StatCard'
import { ReportFilters } from '../components/reports/ReportFilters'
import { StatementsPanel } from './StatementsPage'
import { AsyncContent, EmptyState } from '../components/states'
import { Badge, Change, PageHeader, Panel, Segmented } from '../components/ui'
import { useApi } from '../hooks/useApi'
import { useTheme } from '../theme'
import type { Report, ReportBreakdownRow, ReportDimension, ReportOptions } from '../types'
import { formatCompactCurrency, formatCurrency, formatDate, formatNumber, formatPercent, formatShortDate } from '../utils/format'
import { reportQuery, resolvePeriod, type FilterKey } from '../utils/reportPeriod'

const DIMENSION_LABELS: Record<ReportDimension, string> = {
  category: 'Kategori',
  product: 'Ürün',
  customer: 'Müşteri',
  customerType: 'Müşteri tipi',
  region: 'Bölge',
  department: 'Departman',
  project: 'Proje',
}

/** Kırılımdaki satıra tıklanınca uygulanan filtre */
const DIMENSION_FILTER: Record<ReportDimension, FilterKey> = {
  category: 'category',
  product: 'productId',
  customer: 'customerId',
  customerType: 'customerType',
  region: 'regionId',
  department: 'department',
  project: 'project',
}

/**
 * Raporlar: satışların yıl, ay, tarih aralığı ve kategori/ürün/müşteri/bölge/departman/proje gibi boyutlara göre
 * filtrelenmiş özeti. Seçimler URL'de tutulur; rapor bağlantısı paylaşılabilir.
 */
export default function ReportsPage() {
  const options = useApi(getReportOptions)
  const [params, setParams] = useSearchParams()
  const [dimension, setDimension] = useState<ReportDimension>('category')

  function update(changes: Record<string, string | null>) {
    const next = new URLSearchParams(params)
    for (const [key, value] of Object.entries(changes)) {
      if (value === null || value === '') next.delete(key)
      else next.set(key, value)
    }
    setParams(next, { replace: true })
  }

  const query = reportQuery(params)
  // Seçili dönemin indirilebilir raporu (PDF/Word): Ekstre & Rapor sayfasında açılır
  const period = resolvePeriod(params)
  const from = period.from ?? options.data?.dataRange.from
  const to = period.to ?? options.data?.dataRange.to
  const downloadLink = from && to ? (from === to ? `/reports?view=statements&kind=daily&date=${from}` : `/reports?view=statements&kind=range&from=${from}&to=${to}`) : '/reports?view=statements&kind=range'

  const view = params.get('view') === 'statements' ? 'statements' : 'analysis'
  // Sekme değişince filtreler sıfırlanır (iki sekmenin tarih parametreleri farklı anlam taşır)
  const switchView = (next: string) => setParams(next === 'statements' ? { view: 'statements' } : {}, { replace: true })

  return (
    <>
      <PageHeader
        title="Raporlar"
        description={
          view === 'analysis'
            ? 'Satışlarınızı istediğiniz döneme ve boyuta göre süzün. Tablolardaki bir satıra tıklayınca o satır filtre olur.'
            : "Aylık ekstre ve gün sonu raporları otomatik oluşur ve bildirim olarak gelir. Buradan veya asistana sorarak (ör. \"Eylül ekstresini istiyorum\") Excel, PDF ya da Word olarak indirebilirsiniz."
        }
        actions={
          view === 'analysis' && (
            <Link className="button" to={downloadLink}>
              Bu dönemi indir
            </Link>
          )
        }
      />
      <div className="report-tabs">
        <Segmented
          label="Rapor görünümü"
          value={view}
          onChange={switchView}
          options={[
            { value: 'analysis', label: 'Analiz' },
            { value: 'statements', label: 'Ekstre & İndir' },
          ]}
        />
      </div>
      {view === 'statements' ? (
        <StatementsPanel />
      ) : (
        <div className="stack">
          <AsyncContent state={options} skeleton={<div className="skeleton" style={{ height: 44 }} />}>
            {(data) => <ReportFilters options={data} params={params} update={update} />}
          </AsyncContent>
          {/* Filtre değişince rapor yeniden yüklenir */}
          <ReportView key={query} params={params} options={options.data} dimension={dimension} onDimension={setDimension} update={update} />
        </div>
      )}
    </>
  )
}

function ReportView({
  params,
  options,
  dimension,
  onDimension,
  update,
}: {
  params: URLSearchParams
  options: ReportOptions | null
  dimension: ReportDimension
  onDimension: (d: ReportDimension) => void
  update: (c: Record<string, string | null>) => void
}) {
  const [offset, setOffset] = useState(0)
  const state = useApi((signal) => getReport(reportQuery(params, offset), signal))

  return (
    <AsyncContent state={state} skeleton={<StatGridSkeleton count={6} />}>
      {(report) =>
        report.totals.orders === 0 ? (
          <Panel>
            <EmptyState title="Bu filtrelere uyan satış yok" description="Dönemi genişletin veya bazı filtreleri kaldırın." />
          </Panel>
        ) : (
          <>
            <Kpis report={report} />
            <Panel
              title="Ciro"
              subtitle={`${formatDate(report.period.from)} – ${formatDate(report.period.to)} · ${
                report.series.granularity === 'day' ? 'günlük' : report.series.granularity === 'week' ? 'haftalık' : 'aylık'
              }`}
            >
              <SeriesChart report={report} />
            </Panel>
            <Panel
              title="Kırılım"
              subtitle="Satıra tıklayınca filtre olarak uygulanır"
              actions={
                <Segmented
                  label="Kırılım boyutu"
                  value={dimension}
                  onChange={onDimension}
                  options={(Object.keys(DIMENSION_LABELS) as ReportDimension[])
                    .filter((d) => (d !== 'department' || (options?.departments.length ?? 0) > 0) && (d !== 'project' || (options?.projects.length ?? 0) > 0))
                    .map((d) => ({ value: d, label: DIMENSION_LABELS[d] }))}
                />
              }
            >
              <BreakdownTable
                rows={report.breakdowns[dimension]}
                onSelect={(row) =>
                  update({ [DIMENSION_FILTER[dimension]]: row.key === null ? (options?.noneValue ?? null) : String(row.key) })
                }
              />
            </Panel>
            <Panel title="Siparişler" subtitle={`${formatNumber(report.orders.total)} sipariş · yeniden eskiye`}>
              <OrdersTable report={report} onPage={(next) => { setOffset(next); state.reload() }} />
            </Panel>
          </>
        )
      }
    </AsyncContent>
  )
}

function Kpis({ report }: { report: Report }) {
  const { totals, changes } = report
  const previous = `önceki dönem: ${formatDate(report.previousPeriod.from)} – ${formatDate(report.previousPeriod.to)}`
  return (
    <div className="grid grid-kpi">
      <StatCard label="Ciro" value={formatCompactCurrency(totals.revenue)} change={changes.revenue} hint={previous} tone="accent" />
      <StatCard label="Sipariş" value={formatNumber(totals.orders)} change={changes.orders} hint={`ort. ${formatCompactCurrency(totals.avgOrderValue)}`} tone="accent" />
      <StatCard label="Müşteri" value={formatNumber(totals.customers)} change={changes.customers} hint="bu dönemde alım yapan" tone="accent" />
      <StatCard label="Satılan adet" value={formatNumber(totals.units)} change={changes.units} tone="accent" />
      {totals.grossProfit === null ? (
        <StatCard label="Brüt kâr" value="—" hint="ürün maliyetleri girilmemiş" tone="neutral" />
      ) : (
        <StatCard
          label="Brüt kâr"
          value={formatCompactCurrency(totals.grossProfit)}
          change={changes.grossProfit}
          hint={`marj ${formatPercent(totals.grossMarginPct ?? 0, { digits: 1 })}`}
          tone="opportunity"
        />
      )}
      {report.expenses !== null && (
        <StatCard
          label="Giderler"
          value={formatCompactCurrency(report.expenses)}
          hint={report.netContribution === null ? 'dönemdeki giderler' : `net katkı ${formatCompactCurrency(report.netContribution)} (ciro − maliyet − gider)`}
          tone={report.netContribution !== null && report.netContribution < 0 ? 'risk' : 'warning'}
        />
      )}
    </div>
  )
}

function SeriesChart({ report }: { report: Report }) {
  const { chart } = useTheme()
  const tooltip = tooltipStyles(chart)
  const { granularity, points } = report.series
  const label = (start: string) =>
    granularity === 'month'
      ? new Intl.DateTimeFormat('tr-TR', { month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${start}T00:00:00Z`))
      : formatShortDate(start)

  return (
    <ResponsiveContainer width="100%" height={280} initialDimension={{ width: 800, height: 280 }}>
      <BarChart data={points} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid stroke={chart.grid} vertical={false} />
        <XAxis dataKey="start" tickFormatter={label} stroke={chart.axis} tick={{ fontSize: 12 }} tickLine={false} axisLine={false} minTickGap={16} />
        <YAxis tickFormatter={(v: number) => formatCompactCurrency(v)} stroke={chart.axis} tick={{ fontSize: 12 }} tickLine={false} axisLine={false} width={72} />
        <Tooltip
          {...tooltip}
          cursor={{ fill: chart.grid, opacity: 0.5 }}
          labelFormatter={(start) => (granularity === 'week' ? `${formatDate(String(start))} haftası` : granularity === 'month' ? label(String(start)) : formatDate(String(start)))}
          formatter={(value, _name, item) => [`${formatCurrency(Number(value))} · ${formatNumber((item.payload as { orders: number }).orders)} sipariş`, 'Ciro']}
        />
        <Bar dataKey="revenue" fill={chart.current} radius={[4, 4, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  )
}

function BreakdownTable({ rows, onSelect }: { rows: ReportBreakdownRow[]; onSelect: (row: ReportBreakdownRow) => void }) {
  if (rows.length === 0) return <EmptyState title="Kırılım yok" />
  return (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr>
            <th>Ad</th>
            <th className="num">Ciro</th>
            <th style={{ width: '22%' }}>Pay</th>
            <th className="num">Önceki döneme göre</th>
            <th className="num">Sipariş</th>
            <th className="num">Adet</th>
            <th className="num">Brüt marj</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={String(row.key)} className="clickable-row" onClick={() => onSelect(row)} title="Bu satırı filtre olarak uygula">
              <td>{row.name ?? <span className="faint">Atanmamış</span>}</td>
              <td className="num">{formatCurrency(row.revenue)}</td>
              <td>
                <div className="share-bar">
                  <span style={{ width: `${Math.max(row.share * 100, 1)}%` }} />
                  <em>{formatPercent(row.share, { digits: 1 })}</em>
                </div>
              </td>
              <td className="num">
                <Change value={row.changePct} />
              </td>
              <td className="num">{formatNumber(row.orders)}</td>
              <td className="num">{formatNumber(row.units)}</td>
              <td className="num">{row.grossMarginPct === null ? '—' : formatPercent(row.grossMarginPct, { digits: 1 })}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function OrdersTable({ report, onPage }: { report: Report; onPage: (offset: number) => void }) {
  const { items, total, offset, pageSize } = report.orders
  return (
    <>
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>Tarih</th>
              <th>Sipariş</th>
              <th>Müşteri</th>
              <th>Departman / Proje</th>
              <th className="num">Kalem</th>
              <th className="num">Tutar</th>
              <th>Durum</th>
            </tr>
          </thead>
          <tbody>
            {items.map((order) => (
              <tr key={order.id}>
                <td className="nowrap">{formatDate(order.date)}</td>
                <td>{order.orderNo ?? `#${order.id}`}</td>
                <td>
                  {order.customer}
                  <div className="cell-sub">{order.region}</div>
                </td>
                <td>
                  {order.department ?? <span className="faint">—</span>}
                  {order.project && <div className="cell-sub">{order.project}</div>}
                </td>
                <td className="num">{order.items}</td>
                <td className="num">{formatCurrency(order.amount)}</td>
                <td>
                  <Badge tone={order.status === 'cancelled' ? 'muted' : 'opportunity'} dot>
                    {order.status === 'cancelled' ? 'İptal' : 'Teslim edildi'}
                  </Badge>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {total > pageSize && (
        <div className="form-actions" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
          <button type="button" className="button button-small" disabled={offset === 0} onClick={() => onPage(Math.max(0, offset - pageSize))}>
            ← Daha yeni
          </button>
          <span className="faint" style={{ fontSize: 12.5 }}>
            {formatNumber(offset + 1)}–{formatNumber(Math.min(offset + pageSize, total))} / {formatNumber(total)}
          </span>
          <button type="button" className="button button-small" disabled={offset + pageSize >= total} onClick={() => onPage(offset + pageSize)}>
            Daha eski →
          </button>
        </div>
      )}
    </>
  )
}
