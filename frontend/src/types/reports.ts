/** GET /api/reports/options */
export interface ReportOptions {
  categories: string[]
  products: { id: number; name: string; category: string }[]
  customers: { id: number; name: string }[]
  regions: { id: number; name: string }[]
  departments: string[]
  projects: string[]
  customerTypes: string[]
  dataRange: { from: string | null; to: string | null }
  /** Departman/proje filtresinde "atanmamış" değeri */
  noneValue: string
}

export type ReportDimension = 'category' | 'product' | 'customer' | 'customerType' | 'region' | 'department' | 'project'

export interface ReportTotals {
  revenue: number
  units: number
  orders: number
  customers: number
  avgOrderValue: number
  grossProfit: number | null
  grossMarginPct: number | null
  costCoverage: number
}

export interface ReportBreakdownRow {
  key: string | number | null
  name: string | null
  revenue: number
  units: number
  orders: number
  share: number
  previousRevenue: number
  changePct: number | null
  grossMarginPct: number | null
}

export interface ReportOrder {
  id: number
  orderNo: string | null
  date: string
  status: 'delivered' | 'cancelled'
  customer: string
  region: string
  department: string | null
  project: string | null
  items: number
  amount: number
}

/** GET /api/reports/summary */
export interface Report {
  period: { from: string; to: string; days: number }
  previousPeriod: { from: string; to: string }
  totals: ReportTotals
  previousTotals: ReportTotals
  changes: Record<'revenue' | 'orders' | 'customers' | 'units' | 'avgOrderValue' | 'grossProfit', number | null>
  expenses: number | null
  netContribution: number | null
  series: { granularity: 'day' | 'week' | 'month'; points: { start: string; revenue: number; orders: number; units: number }[] }
  breakdowns: Record<ReportDimension, ReportBreakdownRow[]>
  orders: { total: number; items: ReportOrder[]; offset: number; pageSize: number }
  dataRange: { from: string | null; to: string | null }
}
