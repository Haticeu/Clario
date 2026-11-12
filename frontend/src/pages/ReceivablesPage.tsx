import { useState, type FormEvent } from 'react'
import { useSearchParams } from 'react-router'
import { getReceivablesReport, saveReceivableSettings, setExpensePaid, toApiError } from '../api'
import { StatCard, StatGridSkeleton } from '../components/StatCard'
import { EmptyState } from '../components/states'
import { Badge, PageHeader, Panel, Segmented } from '../components/ui'
import { useApi } from '../hooks/useApi'
import type { AgingBucket, ReceivablesReport, ReceivableSettings } from '../types'
import { notifyDataChanged } from '../utils/dataEvents'
import { formatDate, formatNumber } from '../utils/format'
import { openLedger } from '../utils/overlay'
import { todayLocal } from '../utils/reportPeriod'

const AGING: { key: AgingBucket; label: string; tone: string }[] = [
  { key: 'current', label: 'Vadesi gelmemiş', tone: 'var(--opportunity)' },
  { key: 'd1_30', label: '1–30 gün', tone: 'var(--warning)' },
  { key: 'd31_60', label: '31–60 gün', tone: '#f97316' },
  { key: 'd61_90', label: '61–90 gün', tone: 'var(--risk)' },
  { key: 'd90plus', label: '90+ gün', tone: '#991b1b' },
]

type Tab = 'customers' | 'suppliers'

/**
 * Cari hesap ve alacak takibi: müşteri bakiyeleri, vadesi geçen alacakların yaşlandırması, tedarikçi borçları ve
 * önümüzdeki 30 günün tahsilat/ödeme görünümü. Veriler e-Fatura, ERP/Excel aktarımı veya elle girişten gelir.
 */
export default function ReceivablesPage() {
  const report = useApi(getReceivablesReport)
  const [params, setParams] = useSearchParams()
  const tab: Tab = params.get('tab') === 'suppliers' ? 'suppliers' : 'customers'

  return (
    <>
      <PageHeader
        title="Cari & Alacak"
        description="Kimden ne kadar alacağınız, vadesi geçenler, tedarikçilere borçlarınız ve önümüzdeki 30 günün nakit görünümü. Faturalar satışlardan (e-Fatura dahil), tahsilatlar Veri Yönetimi → Tahsilatlar'dan gelir."
      />
      {report.error && <div className="alert tone-risk">{report.error.message}</div>}
      {!report.data && !report.error && <StatGridSkeleton count={4} />}
      {report.data?.setupRequired && <SetupPanel settings={report.data.settings} onSaved={report.reload} />}
      {report.data && !report.data.setupRequired && (
        <ReceivablesContent data={report.data} tab={tab} onTab={(t) => setParams(t === 'customers' ? {} : { tab: t }, { replace: true })} onChanged={report.reload} />
      )}
    </>
  )
}

function useMoney(currency: string) {
  const f = new Intl.NumberFormat('tr-TR', { style: 'currency', currency, maximumFractionDigits: 0 })
  return (v: number) => f.format(v)
}

/** İlk kurulum: takip başlangıcı, varsayılan vade ve firma vergi numarası */
function SetupPanel({ settings, onSaved, compact = false }: { settings: ReceivableSettings; onSaved: () => void; compact?: boolean }) {
  const today = todayLocal()
  const [startDate, setStartDate] = useState(settings.startDate ?? `${today.slice(0, 7)}-01`)
  const [term, setTerm] = useState(String(settings.defaultTermDays))
  const [taxId, setTaxId] = useState(settings.companyTaxId ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await saveReceivableSettings({ startDate, defaultTermDays: Number(term), companyTaxId: taxId.trim() || null })
      notifyDataChanged()
      onSaved()
    } catch (err) {
      setError(toApiError(err).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Panel
      title={compact ? 'Takip ayarları' : 'Cari takibi başlatın'}
      subtitle={
        compact
          ? undefined
          : 'Hangi tarihten itibaren faturaların açık alacak sayılacağını seçin. Bu tarihten önceki satışlar kapanmış (tahsil edilmiş) kabul edilir; böylece geçmiş verileriniz yanlışlıkla "vadesi geçmiş" görünmez.'
      }
    >
      <form className="ar-setup" onSubmit={(e) => void submit(e)}>
        <label className="field">
          <span>Takip başlangıcı</span>
          <input className="input" type="date" required value={startDate} max={today} onChange={(e) => setStartDate(e.target.value)} />
        </label>
        <label className="field">
          <span>Varsayılan vade (gün)</span>
          <input className="input" type="number" min={0} max={365} required value={term} onChange={(e) => setTerm(e.target.value)} />
        </label>
        <label className="field">
          <span>Firma vergi no (e-Fatura için)</span>
          <input className="input" inputMode="numeric" placeholder="VKN veya TCKN" value={taxId} onChange={(e) => setTaxId(e.target.value)} />
        </label>
        <button type="submit" className="button button-primary" disabled={busy}>
          {busy ? 'Kaydediliyor…' : compact ? 'Kaydet' : 'Takibi başlat'}
        </button>
        {error && <div className="alert tone-risk" style={{ gridColumn: '1 / -1' }}>{error}</div>}
      </form>
      {!compact && (
        <p className="faint" style={{ fontSize: 13, marginTop: 12 }}>
          Vade: faturada vade tarihi varsa o, yoksa müşterinin vadesi (Müşteriler sekmesi), o da yoksa buradaki varsayılan kullanılır. Firma vergi
          numarası, e-Fatura yüklerken giden (satış) ve gelen (alış) faturaları ayırmak için kullanılır; boşsa ilk yüklemede tespit edilir.
        </p>
      )}
    </Panel>
  )
}

function AgingBar({ data, money }: { data: ReceivablesReport; money: (v: number) => string }) {
  const total = AGING.reduce((sum, a) => sum + data.summary.aging[a.key], 0)
  if (total <= 0) return null
  return (
    <Panel title="Alacak yaşlandırması" subtitle="Açık alacakların vadesine göre dağılımı">
      <div className="aging-bar" role="img" aria-label="Yaşlandırma">
        {AGING.map((a) => {
          const value = data.summary.aging[a.key]
          return value > 0 ? <span key={a.key} style={{ width: `${(value / total) * 100}%`, background: a.tone }} title={`${a.label}: ${money(value)}`} /> : null
        })}
      </div>
      <div className="aging-legend">
        {AGING.map((a) => (
          <div key={a.key}>
            <i style={{ background: a.tone }} />
            <span>{a.label}</span>
            <b>{money(data.summary.aging[a.key])}</b>
          </div>
        ))}
      </div>
    </Panel>
  )
}

function Outlook({ data, money }: { data: ReceivablesReport; money: (v: number) => string }) {
  const max = Math.max(1, ...data.outlook.flatMap((w) => [w.collections, w.payments]))
  const net = data.outlook.reduce((sum, w) => sum + w.collections - w.payments, 0)
  return (
    <Panel title="Önümüzdeki 30 gün" subtitle={`Vadelere göre beklenen tahsilat ve ödemeler · net ${money(net)}`}>
      <div className="outlook">
        {data.outlook.map((w, i) => (
          <div key={w.week} className="outlook-row">
            <span className="outlook-label">{i === 0 ? 'Bu hafta' : `${formatDate(w.week).slice(0, 5)} haftası`}</span>
            <div className="outlook-bars">
              <span className="outlook-in" style={{ width: `${(w.collections / max) * 100}%` }} title={`Tahsilat ${money(w.collections)}`} />
              <span className="outlook-out" style={{ width: `${(w.payments / max) * 100}%` }} title={`Ödeme ${money(w.payments)}`} />
            </div>
            <span className="outlook-values">
              <span style={{ color: 'var(--opportunity)' }}>+{money(w.collections)}</span>
              <span style={{ color: 'var(--risk)' }}>−{money(w.payments)}</span>
            </span>
          </div>
        ))}
      </div>
      <p className="faint" style={{ fontSize: 12.5, marginTop: 10 }}>
        Vadesi geçmiş alacak ve borçlar "Bu hafta" satırında gösterilir. Gerçekleşme müşterilerin ödeme alışkanlığına göre değişebilir.
      </p>
    </Panel>
  )
}

function ReceivablesContent({ data, tab, onTab, onChanged }: { data: ReceivablesReport; tab: Tab; onTab: (t: Tab) => void; onChanged: () => void }) {
  const money = useMoney(data.currency)
  const s = data.summary
  const [showSettings, setShowSettings] = useState(false)
  const [busyId, setBusyId] = useState<number | null>(null)

  async function markPaid(expenseId: number) {
    setBusyId(expenseId)
    try {
      await setExpensePaid(expenseId, todayLocal())
      notifyDataChanged()
      onChanged()
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div className="stack">
      <div className="grid grid-kpi">
        <StatCard label="Toplam alacak" value={money(s.totalReceivable)} hint={`${formatNumber(data.customers.filter((c) => c.balance > 0).length)} müşteri`} tone="accent" />
        <StatCard
          label="Vadesi geçen"
          value={money(s.overdue)}
          hint={s.overdueCustomers ? `${s.overdueCustomers} müşteri${s.overLimitCustomers ? ` · ${s.overLimitCustomers} limit aşımı` : ''}` : 'gecikme yok'}
          tone={s.overdue > 0 ? 'risk' : 'opportunity'}
        />
        <StatCard label="Ort. tahsil süresi" value={s.dso === null ? '—' : `${s.dso} gün`} hint={`son 30 günde tahsil: ${money(s.collectedLast30)}`} />
        <StatCard label="Tedarikçi borcu" value={money(s.totalPayable)} hint={`bu hafta: ${money(s.payableNext7)}${s.overduePayable ? ` · gecikmiş ${money(s.overduePayable)}` : ''}`} tone={s.overduePayable > 0 ? 'warning' : 'neutral'} />
      </div>

      <div className="grid grid-2">
        <AgingBar data={data} money={money} />
        <Outlook data={data} money={money} />
      </div>

      <div className="report-tabs">
        <Segmented
          label="Cari türü"
          value={tab}
          onChange={onTab}
          options={[
            { value: 'customers', label: `Müşteriler (alacak)` },
            { value: 'suppliers', label: `Tedarikçiler (borç)` },
          ]}
        />
      </div>

      {tab === 'customers' &&
        (data.customers.length === 0 ? (
          <EmptyState title="Açık alacak yok" description="Takip başlangıcından sonraki faturaların tamamı tahsil edilmiş veya henüz fatura yok." />
        ) : (
          <Panel title="Müşteri bakiyeleri" subtitle="Satıra dokununca cari hesap ekstresi açılır">
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Müşteri</th>
                    <th className="num">Bakiye</th>
                    <th className="num">Vadesi geçen</th>
                    <th className="num">Gecikme</th>
                    <th className="num">Son tahsilat</th>
                  </tr>
                </thead>
                <tbody>
                  {data.customers.map((c) => (
                    <tr key={c.customerId} className="clickable-row" onClick={() => openLedger(c.customerId)}>
                      <td>
                        {c.name}
                        <div className="cell-sub">
                          {c.regionName}
                          {c.salesRepName && ` · ${c.salesRepName}`}
                          {c.overLimit && (
                            <>
                              {' '}
                              <Badge tone="risk">Limit aşıldı</Badge>
                            </>
                          )}
                        </div>
                      </td>
                      <td className="num">{c.balance < 0 ? <span className="faint">{money(c.balance)} avans</span> : money(c.balance)}</td>
                      <td className="num" style={{ color: c.overdue > 0 ? 'var(--risk)' : undefined }}>{c.overdue > 0 ? money(c.overdue) : '—'}</td>
                      <td className="num">{c.oldestOverdueDays > 0 ? `${c.oldestOverdueDays} gün` : c.nextDueDate ? `vade ${formatDate(c.nextDueDate)}` : '—'}</td>
                      <td className="num">{c.lastPaymentDate ? formatDate(c.lastPaymentDate) : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>
        ))}

      {tab === 'suppliers' &&
        (data.suppliers.length === 0 ? (
          <EmptyState
            title="Ödenmemiş tedarikçi faturası yok"
            description="Gelen e-Faturalar ve tedarikçisi/vadesi girilen giderler burada borç olarak görünür; ödenince işaretleyin."
          />
        ) : (
          data.suppliers.map((sup) => (
            <Panel key={sup.supplier} title={sup.supplier} subtitle={`Borç ${money(sup.balance)}${sup.overdue ? ` · vadesi geçen ${money(sup.overdue)}` : ''}`}>
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Fatura</th>
                      <th className="num">Vade</th>
                      <th className="num">Tutar</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {sup.invoices.map((inv) => (
                      <tr key={inv.expenseId}>
                        <td>
                          {inv.invoiceNo ?? formatDate(inv.date)}
                          {inv.description && <div className="cell-sub">{inv.description}</div>}
                        </td>
                        <td className="num" style={{ color: inv.daysOverdue > 0 ? 'var(--risk)' : undefined }}>
                          {formatDate(inv.dueDate)}
                          {inv.daysOverdue > 0 && <div className="cell-sub">{inv.daysOverdue} gün geçti</div>}
                        </td>
                        <td className="num">{money(inv.amount)}</td>
                        <td className="num">
                          <button type="button" className="button button-small" disabled={busyId === inv.expenseId} onClick={() => void markPaid(inv.expenseId)}>
                            Ödendi
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Panel>
          ))
        ))}

      <div>
        <button type="button" className="link-button" onClick={() => setShowSettings((v) => !v)}>
          {showSettings ? 'Takip ayarlarını gizle' : `Takip ayarları (başlangıç ${formatDate(data.settings.startDate!)}, vade ${data.settings.defaultTermDays} gün)`}
        </button>
      </div>
      {showSettings && <SetupPanel settings={data.settings} onSaved={onChanged} compact />}
    </div>
  )
}
