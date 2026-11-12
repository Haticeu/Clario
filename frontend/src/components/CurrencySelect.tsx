import { getCurrencyInfo } from '../api'
import { useCurrency } from '../currency'
import { useApi } from '../hooks/useApi'
import { formatDate } from '../utils/format'

/** Ayarlar'da analizlerin gösterileceği para birimi seçimi ve kullanılan kur. */
export function CurrencySelect() {
  const { base, display, currencies, setDisplay } = useCurrency()
  return (
    <div className="currency-select">
      <label className="visually-hidden" htmlFor="display-currency">
        Gösterim para birimi
      </label>
      <select id="display-currency" className="input" value={display} onChange={(e) => setDisplay(e.target.value)} title="Tutarların gösterileceği para birimi">
        {currencies.map((c) => (
          <option key={c.code} value={c.code}>
            {c.symbol} {c.code}
            {c.code === base ? ' (veri)' : ''}
          </option>
        ))}
      </select>
      {display !== base && <RateHint key={`${base}-${display}`} />}
    </div>
  )
}

function RateHint() {
  const { data, error } = useApi(getCurrencyInfo)
  if (error) return <div className="data-date" style={{ color: 'var(--risk)' }}>Kur alınamadı</div>
  if (!data || data.rateDate === null) return null
  const rate = data.rate >= 1 ? data.rate : 1 / data.rate
  const [from, to] = data.rate >= 1 ? [data.base, data.display] : [data.display, data.base]
  return (
    <div className="data-date" title={`Her kayıt kendi tarihindeki kurla çevrilir. Kaynak: ${data.source}`}>
      1 {from} = {rate.toLocaleString('tr-TR', { maximumFractionDigits: 4 })} {to} · {formatDate(data.rateDate)}
    </div>
  )
}
