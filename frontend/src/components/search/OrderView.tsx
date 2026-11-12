import { Link } from 'react-router'
import { getOrderDetail } from '../../api'
import { useApi } from '../../hooks/useApi'
import { formatCurrency, formatDate, formatNumber } from '../../utils/format'
import { Sheet } from '../overlay/Sheet'
import { Badge } from '../ui'

/** Tek işlemin (siparişin) ayrıntısı: müşteri, tarih, kalemler ve tutar. Aramadan açılır. */
export function OrderView({ id, onClose }: { id: number; onClose: () => void }) {
  const order = useApi((signal) => getOrderDetail(id, signal))
  const data = order.data

  return (
    <Sheet
      title="İşlem ayrıntısı"
      onClose={onClose}
      footer={
        data && (
          <Link className="button" to={`/reports?period=all&customerId=${data.customerId}`} onClick={onClose}>
            {data.customerName} raporu →
          </Link>
        )
      }
    >
      {order.loading && !data && <div className="faint">Yükleniyor…</div>}
      {order.error && <div className="faint">{order.error.message}</div>}
      {data && (
        <div className="order-view">
          <div className="order-head">
            <div>
              <div className="order-no">{data.orderNo ?? `#${data.id}`}</div>
              <div className="faint">{formatDate(data.date)}</div>
            </div>
            <Badge tone={data.status === 'delivered' ? 'opportunity' : 'risk'}>{data.status === 'delivered' ? 'Teslim edildi' : 'İptal'}</Badge>
          </div>

          <dl className="order-facts">
            <div>
              <dt>Müşteri</dt>
              <dd>{data.customerName}</dd>
            </div>
            <div>
              <dt>Bölge</dt>
              <dd>{data.regionName}</dd>
            </div>
            {data.salesRepName && (
              <div>
                <dt>Satış temsilcisi</dt>
                <dd>{data.salesRepName}</dd>
              </div>
            )}
            {data.department && (
              <div>
                <dt>Departman</dt>
                <dd>{data.department}</dd>
              </div>
            )}
            {data.project && (
              <div>
                <dt>Proje</dt>
                <dd>{data.project}</dd>
              </div>
            )}
          </dl>

          <table className="table order-lines">
            <thead>
              <tr>
                <th>Ürün</th>
                <th className="num">Adet</th>
                <th className="num">Birim fiyat</th>
                <th className="num">Tutar</th>
              </tr>
            </thead>
            <tbody>
              {data.lines.map((line, i) => (
                <tr key={i}>
                  <td>
                    {line.name}
                    <div className="faint">
                      {line.sku} · {line.category}
                    </div>
                  </td>
                  <td className="num">{formatNumber(line.quantity)}</td>
                  <td className="num">{formatCurrency(line.unitPrice)}</td>
                  <td className="num">{formatCurrency(line.total)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={3}>Toplam</td>
                <td className="num">{formatCurrency(data.total)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </Sheet>
  )
}
