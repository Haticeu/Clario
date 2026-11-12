import { useState } from 'react'
import { Navigate, useLocation, useSearchParams } from 'react-router'
import { getReportOptions, getStatement, statementExcelPath, toApiError } from '../api'
import { StatCard, StatGridSkeleton } from '../components/StatCard'
import { EmptyState } from '../components/states'
import { Panel, Segmented } from '../components/ui'
import { useApi } from '../hooks/useApi'
import type { ReportBreakdownRow, Statement, StatementKind } from '../types'
import { downloadApiFile } from '../utils/download'
import { formatCurrency, formatDate, formatNumber, formatPercent } from '../utils/format'
import { todayLocal } from '../utils/reportPeriod'
import { downloadStatementPdf, downloadStatementWord, statementFileName } from '../utils/statementDocs'

const MONTHS = ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık']
const monthName = (month: string) => `${MONTHS[Number(month.slice(5, 7)) - 1]} ${month.slice(0, 4)}`
const ORDER_PREVIEW = 30

const KINDS: { value: StatementKind; label: string }[] = [
  { value: 'monthly', label: 'Aylık ekstre' },
  { value: 'daily', label: 'Gün sonu raporu' },
  { value: 'range', label: 'Tarih aralığı' },
]

/** Veri olan aylar (en yeniden eskiye) */
function monthsBetween(from: string, to: string): string[] {
  const out: string[] = []
  let [y, m] = to.slice(0, 7).split('-').map(Number) as [number, number]
  const [fy, fm] = from.slice(0, 7).split('-').map(Number) as [number, number]
  while (y > fy || (y === fy && m >= fm)) {
    out.push(`${y}-${String(m).padStart(2, '0')}`)
    m -= 1
    if (m === 0) {
      m = 12
      y -= 1
    }
    if (out.length > 240) break
  }
  return out
}

function previousMonth(today: string): string {
  const [y, m] = today.split('-').map(Number) as [number, number]
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`
}

/** Eski /statements adresi (bildirimler, yer imleri): Raporlar → Ekstre & İndir sekmesine yönlendirir */
export default function StatementsRedirect() {
  const { search } = useLocation()
  const params = new URLSearchParams(search)
  params.set('view', 'statements')
  return <Navigate to={`/reports?${params}`} replace />
}

/**
 * Raporlar → "Ekstre & İndir": aylık ekstre (Excel; istenirse PDF), gün sonu raporu ve istenen tarih aralığı için
 * genel rapor (PDF/Word). Seçim URL'de tutulur; bildirimden veya asistandan açılınca ilgili dönem gelir.
 */
export function StatementsPanel() {
  const [params, setParams] = useSearchParams()
  const options = useApi(getReportOptions)
  const today = todayLocal()
  const range = options.data?.dataRange
  const lastDataDay = range?.to ?? today

  const kind = (KINDS.some((k) => k.value === params.get('kind')) ? params.get('kind') : 'monthly') as StatementKind
  const months = range?.from && range.to ? monthsBetween(range.from, range.to > today ? range.to : today) : [previousMonth(today)]
  // Varsayılan: geçen ay (verisi varsa), yoksa verinin son ayı
  const defaultMonth = months.includes(previousMonth(today)) ? previousMonth(today) : (months.find((m) => m <= lastDataDay.slice(0, 7)) ?? months[0]!)
  const month = params.get('month') ?? defaultMonth
  const date = params.get('date') ?? (lastDataDay < today ? lastDataDay : today)
  const from = params.get('from') ?? `${lastDataDay.slice(0, 7)}-01`
  const to = params.get('to') ?? lastDataDay

  const query =
    kind === 'monthly' ? `kind=monthly&month=${month}` : kind === 'daily' ? `kind=daily&date=${date}` : `kind=range&from=${from}&to=${to}`
  const statement = useApi((signal) => (options.data ? getStatement(query, signal) : new Promise<never>(() => {})))
  // Seçim değişince (ve dönem seçenekleri ilk yüklendiğinde) rapor yeniden çekilir
  const requestKey = `${query}|${options.data ? 1 : 0}`
  const [lastKey, setLastKey] = useState(requestKey)
  if (lastKey !== requestKey) {
    setLastKey(requestKey)
    statement.reload()
  }

  const update = (changes: Record<string, string | null>) => {
    const next = new URLSearchParams(params)
    for (const [key, value] of Object.entries(changes)) {
      if (value) next.set(key, value)
      else next.delete(key)
    }
    setParams(next, { replace: true })
  }

  const rangeInvalid = kind === 'range' && from > to

  return (
    <>
      <div className="stack">
        <Panel>
          <div className="statement-controls">
            <Segmented label="Rapor türü" options={KINDS} value={kind} onChange={(value) => update({ kind: value })} />
            {kind === 'monthly' && (
              <label className="field">
                <span>Ay</span>
                <select className="input" value={month} onChange={(e) => update({ month: e.target.value })}>
                  {months.map((m) => (
                    <option key={m} value={m}>
                      {monthName(m)}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {kind === 'daily' && (
              <label className="field">
                <span>Gün</span>
                <input className="input" type="date" value={date} max={today} onChange={(e) => e.target.value && update({ date: e.target.value })} />
              </label>
            )}
            {kind === 'range' && (
              <div className="statement-range">
                <label className="field">
                  <span>Başlangıç</span>
                  <input className="input" type="date" value={from} max={to} onChange={(e) => e.target.value && update({ from: e.target.value })} />
                </label>
                <label className="field">
                  <span>Bitiş</span>
                  <input className="input" type="date" value={to} min={from} onChange={(e) => e.target.value && update({ to: e.target.value })} />
                </label>
              </div>
            )}
            <DownloadButtons kind={kind} query={query} statement={statement.data} disabled={rangeInvalid || !statement.data} />
          </div>
        </Panel>

        {rangeInvalid && <div className="alert tone-risk">Başlangıç tarihi bitiş tarihinden sonra olamaz.</div>}
        {statement.error && !rangeInvalid && <div className="alert tone-risk">{statement.error.message}</div>}
        {!statement.data && !statement.error && <StatGridSkeleton count={4} />}
        {statement.data && <StatementPreview s={statement.data} />}
      </div>
    </>
  )
}

function DownloadButtons({ kind, query, statement, disabled }: { kind: StatementKind; query: string; statement: Statement | null; disabled: boolean }) {
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function run(label: string, work: () => Promise<void>) {
    setBusy(label)
    setError(null)
    try {
      await work()
    } catch (err) {
      setError(toApiError(err).message)
    } finally {
      setBusy(null)
    }
  }

  const excel = () =>
    run('excel', () => downloadApiFile(statementExcelPath(query), statement ? statementFileName(statement, 'xlsx') : 'Clario-ekstre.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'))

  return (
    <div className="statement-actions">
      {kind === 'monthly' ? (
        <>
          <button type="button" className="button button-primary" disabled={disabled || busy !== null} onClick={() => void excel()}>
            {busy === 'excel' ? 'Hazırlanıyor…' : 'Excel indir'}
          </button>
          <button type="button" className="button" disabled={disabled || busy !== null} onClick={() => statement && void run('pdf', () => downloadStatementPdf(statement))}>
            {busy === 'pdf' ? 'Hazırlanıyor…' : 'PDF indir'}
          </button>
        </>
      ) : (
        <>
          <button type="button" className="button button-primary" disabled={disabled || busy !== null} onClick={() => statement && void run('pdf', () => downloadStatementPdf(statement))}>
            {busy === 'pdf' ? 'Hazırlanıyor…' : 'PDF indir'}
          </button>
          <button type="button" className="button" disabled={disabled || busy !== null} onClick={() => statement && void run('word', () => downloadStatementWord(statement))}>
            {busy === 'word' ? 'Hazırlanıyor…' : 'Word indir'}
          </button>
        </>
      )}
      {error && <span className="statement-error">{error}</span>}
    </div>
  )
}

function BreakdownTable({ title, rows }: { title: string; rows: ReportBreakdownRow[] }) {
  if (rows.length === 0) return null
  return (
    <Panel title={title}>
      <table className="table">
        <thead>
          <tr>
            <th>Ad</th>
            <th className="num">Ciro</th>
            <th className="num">Pay</th>
          </tr>
        </thead>
        <tbody>
          {rows.slice(0, 8).map((r) => (
            <tr key={String(r.key)}>
              <td>{r.name ?? 'Atanmamış'}</td>
              <td className="num">{formatCurrency(r.revenue)}</td>
              <td className="num">{formatPercent(r.share)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Panel>
  )
}

function StatementPreview({ s }: { s: Statement }) {
  const t = s.totals
  const empty = t.orders === 0 && s.expenses === 0
  return (
    <>
      <Panel
        title={s.title}
        subtitle={`${s.period.from === s.period.to ? formatDate(s.period.from) : `${formatDate(s.period.from)} – ${formatDate(s.period.to)}`} · ${s.business.name ?? ''}`}
      >
        <ul className="statement-highlights">
          {s.highlights.map((h) => (
            <li key={h}>{h}</li>
          ))}
        </ul>
      </Panel>
      {empty ? (
        <EmptyState title="Bu dönemde kayıt yok" description="Başka bir dönem seçin veya Veri Yönetimi'nden satışlarınızı ekleyin." />
      ) : (
        <>
          <div className="grid grid-kpi">
            <StatCard label="Ciro" value={formatCurrency(t.revenue)} change={s.changes.revenue} tone="accent" />
            <StatCard label="Sipariş" value={formatNumber(t.orders)} change={s.changes.orders} hint={`ort. ${formatCurrency(t.avgOrderValue)}`} />
            <StatCard label="Giderler" value={formatCurrency(s.expenses)} hint={`net katkı ${formatCurrency(s.netContribution)}`} />
            <StatCard
              label="Brüt kâr"
              value={t.grossProfit === null ? '—' : formatCurrency(t.grossProfit)}
              hint={t.grossMarginPct === null ? 'maliyet bilgisi yok' : `marj ${formatPercent(t.grossMarginPct)}`}
            />
          </div>
          <div className="grid grid-2">
            <BreakdownTable title="Kategoriler" rows={s.categories} />
            <BreakdownTable title="En çok satan ürünler" rows={s.products} />
            <BreakdownTable title="En büyük müşteriler" rows={s.customers} />
            {s.expenseCategories.length > 0 && (
              <Panel title="Giderler">
                <table className="table">
                  <tbody>
                    {s.expenseCategories.map((e) => (
                      <tr key={e.category}>
                        <td>{e.category}</td>
                        <td className="num">{formatCurrency(e.amount)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Panel>
            )}
          </div>
          {s.orders.length > 0 && (
            <Panel title={`İşlemler (${formatNumber(s.ordersTotal)})`} subtitle={s.ordersTotal > ORDER_PREVIEW ? `Son ${ORDER_PREVIEW} işlem; tamamı indirilen dosyada` : undefined}>
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Tarih</th>
                      <th>No</th>
                      <th>Müşteri</th>
                      <th className="num">Tutar</th>
                    </tr>
                  </thead>
                  <tbody>
                    {s.orders.slice(0, ORDER_PREVIEW).map((o) => (
                      <tr key={o.id} className={o.status === 'cancelled' ? 'faint' : undefined}>
                        <td>{formatDate(o.date)}</td>
                        <td>{o.orderNo ?? `#${o.id}`}</td>
                        <td>
                          {o.customer}
                          {o.status === 'cancelled' && ' · İptal'}
                        </td>
                        <td className="num">{formatCurrency(o.amount)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Panel>
          )}
        </>
      )}
    </>
  )
}
