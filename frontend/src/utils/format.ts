const LOCALE = 'tr-TR'

/**
 * Analiz tutarlarının gösterildiği para birimi. Backend tutarları bu para birimine çevirerek döner
 * (bkz. CurrencyProvider); değiştiğinde sayfalar yeniden yüklenir.
 */
let displayCurrency = 'TRY'

export function setDisplayCurrency(code: string) {
  displayCurrency = code
}

const formatters = new Map<string, Intl.NumberFormat>()
function formatter(code: string, compact: boolean) {
  const key = `${code}|${compact}`
  let result = formatters.get(key)
  if (!result) {
    result = new Intl.NumberFormat(
      LOCALE,
      compact
        ? { style: 'currency', currency: code, notation: 'compact', maximumFractionDigits: 1 }
        : { style: 'currency', currency: code, maximumFractionDigits: 0 },
    )
    formatters.set(key, result)
  }
  return result
}
const dateFormatter = new Intl.DateTimeFormat(LOCALE, { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'UTC' })
const shortDateFormatter = new Intl.DateTimeFormat(LOCALE, { day: 'numeric', month: 'short', timeZone: 'UTC' })

/** ₺1.234.567 — currency verilmezse gösterim para birimi (veri girişi ekranları ana para birimini verir) */
export const formatCurrency = (value: number, currency = displayCurrency) => formatter(currency, false).format(value)

/** ₺1,2 Mn */
export const formatCompactCurrency = (value: number, currency = displayCurrency) => formatter(currency, true).format(value)

/** 12.345 / 5,2 */
export function formatNumber(value: number, fractionDigits = 0) {
  return new Intl.NumberFormat(LOCALE, {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  }).format(value)
}

/** 0.284 → "%28", −0.284 → "−%28"; signed: true ise pozitifler "+%28" */
export function formatPercent(ratio: number, { digits = 0, signed = false } = {}) {
  const body = `%${formatNumber(Math.abs(ratio) * 100, digits)}`
  if (ratio < 0) return `−${body}`
  return signed && ratio > 0 ? `+${body}` : body
}

/** '2026-09-25' → '25.09.2026' */
export const formatDate = (iso: string) => dateFormatter.format(new Date(`${iso}T00:00:00Z`))

/** '2026-09-25' → '25 Eyl' */
export const formatShortDate = (iso: string) => shortDateFormatter.format(new Date(`${iso}T00:00:00Z`))

/** Stok ay değeri: 5.14 → "5,1 ay", null → "satış yok" */
export const formatMonths = (months: number | null) => (months === null ? 'satış yok' : `${formatNumber(months, 1)} ay`)

const relative = new Intl.RelativeTimeFormat('tr', { numeric: 'auto' })

/** "3 saat önce", "dün" */
export function timeAgo(iso: string | null): string {
  if (!iso) return ''
  const minutes = Math.round((Date.now() - Date.parse(iso)) / 60_000)
  if (minutes < 60) return relative.format(-Math.max(minutes, 1), 'minute')
  const hours = Math.round(minutes / 60)
  if (hours < 24) return relative.format(-hours, 'hour')
  return relative.format(-Math.round(hours / 24), 'day')
}
