/** Rapor dönemi seçenekleri. Seçim URL'de tutulur (paylaşılabilir, geri tuşuyla çalışır). */
export type PeriodPreset = 'all' | 'this-month' | 'last-month' | 'last-30' | 'last-90' | 'this-year' | 'last-year' | 'year' | 'month' | 'custom'

export const PERIOD_PRESETS: { value: PeriodPreset; label: string }[] = [
  { value: 'all', label: 'Tüm zamanlar' },
  { value: 'this-month', label: 'Bu ay' },
  { value: 'last-month', label: 'Geçen ay' },
  { value: 'last-30', label: 'Son 30 gün' },
  { value: 'last-90', label: 'Son 90 gün' },
  { value: 'this-year', label: 'Bu yıl' },
  { value: 'last-year', label: 'Geçen yıl' },
  { value: 'year', label: 'Belirli bir yıl' },
  { value: 'month', label: 'Belirli bir ay' },
  { value: 'custom', label: 'Tarih aralığı' },
]

export const MONTH_NAMES = Array.from({ length: 12 }, (_, i) =>
  new Intl.DateTimeFormat('tr-TR', { month: 'long', timeZone: 'UTC' }).format(new Date(Date.UTC(2026, i, 1))),
)

const iso = (d: Date) => d.toISOString().slice(0, 10)
const utc = (y: number, m: number, d: number) => new Date(Date.UTC(y, m, d))

/** Bugün (yerel takvim günü, 'YYYY-AA-GG') */
export function todayLocal(): string {
  const now = new Date()
  return iso(utc(now.getFullYear(), now.getMonth(), now.getDate()))
}

function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return iso(d)
}

export interface ResolvedPeriod {
  /** Verilmezse backend verinin tamamını kullanır */
  from?: string
  to?: string
}

/** URL'deki dönem seçimini somut tarih aralığına çevirir. */
export function resolvePeriod(params: URLSearchParams, today = todayLocal()): ResolvedPeriod {
  const preset = (params.get('period') ?? 'all') as PeriodPreset
  const y = Number(today.slice(0, 4))
  const m = Number(today.slice(5, 7)) - 1
  switch (preset) {
    case 'this-month':
      return { from: iso(utc(y, m, 1)), to: today }
    case 'last-month':
      return { from: iso(utc(y, m - 1, 1)), to: iso(utc(y, m, 0)) }
    case 'last-30':
      return { from: addDays(today, -29), to: today }
    case 'last-90':
      return { from: addDays(today, -89), to: today }
    case 'this-year':
      return { from: iso(utc(y, 0, 1)), to: today }
    case 'last-year':
      return { from: iso(utc(y - 1, 0, 1)), to: iso(utc(y - 1, 11, 31)) }
    case 'year': {
      const year = Number(params.get('year')) || y
      return { from: iso(utc(year, 0, 1)), to: iso(utc(year, 11, 31)) }
    }
    case 'month': {
      const year = Number(params.get('year')) || y
      const month = params.has('month') ? Number(params.get('month')) : m
      return { from: iso(utc(year, month, 1)), to: iso(utc(year, month + 1, 0)) }
    }
    case 'custom':
      return { from: params.get('from') || undefined, to: params.get('to') || undefined }
    default:
      return {}
  }
}

/** Rapor filtre anahtarları (URL ve API'de aynı adlarla) */
export const FILTER_KEYS = ['category', 'productId', 'customerId', 'customerType', 'regionId', 'department', 'project', 'status'] as const
export type FilterKey = (typeof FILTER_KEYS)[number]

/** URL'deki seçimlerden API sorgusu */
export function reportQuery(params: URLSearchParams, offset = 0, today = todayLocal()): string {
  const query = new URLSearchParams()
  const { from, to } = resolvePeriod(params, today)
  if (from) query.set('from', from)
  if (to) query.set('to', to)
  for (const key of FILTER_KEYS) {
    const value = params.get(key)
    if (value) query.set(key, value)
  }
  if (offset) query.set('offset', String(offset))
  return query.toString()
}
