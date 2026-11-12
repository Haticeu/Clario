import { useState } from 'react'
import { customerLedgerExcelPath, getCustomerLedger, toApiError } from '../../api'
import { useApi } from '../../hooks/useApi'
import { downloadApiFile } from '../../utils/download'
import { formatDate } from '../../utils/format'
import { Sheet } from '../overlay/Sheet'

/** Cari hesap ekstresi: faturalar (borç), tahsilatlar (alacak), yürüyen bakiye ve açık faturalar */
export function LedgerView({ customerId, onClose }: { customerId: number; onClose: () => void }) {
  const ledger = useApi((signal) => getCustomerLedger(customerId, signal))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const data = ledger.data
  const money = (v: number) => new Intl.NumberFormat('tr-TR', { style: 'currency', currency: data?.currency ?? 'TRY', maximumFractionDigits: 2 }).format(v)

  async function download() {
    if (!data) return
    setBusy(true)
    setError(null)
    try {
      // Dosya adı: Türkçe harfler sadeleştirilir (bazı cihaz/uygulamalar ASCII olmayan adları bozuyor)
      const safe = data.customer.name
        .replace(/[çÇğĞıİöÖşŞüÜ]/g, (ch) => ({ ç: 'c', Ç: 'C', ğ: 'g', Ğ: 'G', ı: 'i', İ: 'I', ö: 'o', Ö: 'O', ş: 's', Ş: 'S', ü: 'u', Ü: 'U' })[ch] ?? ch)
        .replace(/[^A-Za-z0-9]+/g, '-')
        .replace(/^-|-$/g, '')
        .slice(0, 40)
      await downloadApiFile(customerLedgerExcelPath(customerId), `Clario-cari-ekstre-${safe}-${data.asOf}.xlsx`, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    } catch (err) {
      setError(toApiError(err).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Sheet
      title="Cari hesap ekstresi"
      onClose={onClose}
      footer={
        data && (
          <button type="button" className="button button-primary" disabled={busy} onClick={() => void download()}>
            {busy ? 'Hazırlanıyor…' : 'Excel indir'}
          </button>
        )
      }
    >
      {ledger.loading && !data && <div className="faint">Yükleniyor…</div>}
      {ledger.error && <div className="alert tone-risk">{ledger.error.message}</div>}
      {error && <div className="alert tone-risk">{error}</div>}
      {data && (
        <div className="order-view">
          <div className="order-head">
            <div>
              <div className="order-no">{data.customer.name}</div>
              <div className="faint">
                {data.customer.taxId ? `VKN/TCKN ${data.customer.taxId} · ` : ''}
                {data.customer.regionName} · {formatDate(data.startDate)} – {formatDate(data.asOf)}
              </div>
            </div>
          </div>
          <dl className="order-facts">
            <div>
              <dt>Bakiye</dt>
              <dd>{money(data.balance)}</dd>
            </div>
            <div>
              <dt>Vadesi geçen</dt>
              <dd style={{ color: data.overdue > 0 ? 'var(--risk)' : undefined }}>{money(data.overdue)}</dd>
            </div>
            <div>
              <dt>Vade</dt>
              <dd>{data.customer.paymentTermDays !== null ? `${data.customer.paymentTermDays} gün` : 'genel ayar'}</dd>
            </div>
            {data.customer.creditLimit !== null && (
              <div>
                <dt>Kredi limiti</dt>
                <dd style={{ color: data.balance > data.customer.creditLimit ? 'var(--risk)' : undefined }}>{money(data.customer.creditLimit)}</dd>
              </div>
            )}
          </dl>

          {data.openInvoices.length > 0 && (
            <>
              <div className="ledger-heading">Açık faturalar</div>
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Fatura</th>
                      <th className="num">Vade</th>
                      <th className="num">Kalan</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.openInvoices.map((inv) => (
                      <tr key={inv.orderId}>
                        <td>
                          {inv.orderNo ?? `#${inv.orderId}`}
                          <div className="cell-sub">{formatDate(inv.date)} · {money(inv.amount)}</div>
                        </td>
                        <td className="num" style={{ color: inv.daysOverdue > 0 ? 'var(--risk)' : undefined }}>
                          {formatDate(inv.dueDate)}
                          {inv.daysOverdue > 0 && <div className="cell-sub">{inv.daysOverdue} gün geçti</div>}
                        </td>
                        <td className="num">{money(inv.open)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}

          <div className="ledger-heading">Hareketler</div>
          {data.entries.length === 0 ? (
            <div className="faint">Bu dönemde hareket yok.</div>
          ) : (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Tarih</th>
                    <th>Açıklama</th>
                    <th className="num">Borç</th>
                    <th className="num">Alacak</th>
                    <th className="num">Bakiye</th>
                  </tr>
                </thead>
                <tbody>
                  {[...data.entries].reverse().map((e, i) => (
                    <tr key={i}>
                      <td>{formatDate(e.date)}</td>
                      <td>
                        {e.description}
                        {e.reference && <div className="cell-sub">{e.reference}</div>}
                      </td>
                      <td className="num">{e.debit ? money(e.debit) : ''}</td>
                      <td className="num" style={{ color: e.credit ? 'var(--opportunity)' : undefined }}>{e.credit ? money(e.credit) : ''}</td>
                      <td className="num">{money(e.balance)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </Sheet>
  )
}
