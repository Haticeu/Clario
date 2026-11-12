import type { ReportBreakdownRow, ReportOrder, ReportTotals } from './reports'

export type StatementKind = 'monthly' | 'daily' | 'range'

/** GET /api/statements — aylık ekstre, gün sonu raporu veya tarih aralığı raporu */
export interface Statement {
  kind: StatementKind
  title: string
  period: { from: string; to: string; days: number }
  previousPeriod: { from: string; to: string }
  generatedAt: string
  business: { name: string | null; email: string | null }
  currency: string
  totals: ReportTotals
  previousTotals: ReportTotals
  changes: { revenue: number | null; orders: number | null; customers: number | null; avgOrderValue: number | null }
  expenses: number
  netContribution: number
  cancelled: { orders: number; amount: number }
  newCustomers: number
  days: { date: string; orders: number; units: number; revenue: number }[]
  categories: ReportBreakdownRow[]
  products: ReportBreakdownRow[]
  customers: ReportBreakdownRow[]
  regions: ReportBreakdownRow[]
  projects: ReportBreakdownRow[]
  expenseCategories: { category: string; amount: number; count: number }[]
  orders: ReportOrder[]
  ordersTotal: number
  highlights: string[]
}

/** Zildeki rapor bildirimi */
export interface ReportNotice {
  id: string
  kind: 'monthly' | 'daily' | 'receivables'
  title: string
  body: string
  query: { kind: 'monthly'; month: string } | { kind: 'daily'; date: string } | { kind: 'receivables'; tab: 'customers' | 'suppliers' }
  availableAt: string
}

/** Bildirim ayarları (aylık ekstre, gün sonu raporu ve saati) */
export interface ReportSettings {
  monthly: boolean
  daily: boolean
  dailyHour: number
}
