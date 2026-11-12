import type { DateWindow } from './common'
import type { Recommendation } from './insights'
import type { WeeklyPoint } from './sales'

export interface Kpi {
  current: number
  previous: number
  changePct: number | null
}

export interface DashboardSummary {
  asOf: string
  windows: { current: DateWindow; previous: DateWindow }
  kpis: {
    revenue: Kpi
    orders: Kpi
    activeCustomers: Kpi
    avgOrderValue: Kpi
    /** Ürün maliyetleri bilinmiyorsa current/marginPct null */
    grossProfit: { current: number | null; previous: number | null; changePct: number | null; marginPct: number | null; costCoverage: number }
    monthlyExpenses: {
      months: number
      period: DateWindow
      average: number
      byCategory: { category: string; amount: number }[]
    }
    estimatedNetProfit: number | null
    openRisks: number
    opportunities: number
    churnRisks: number
    highPriorityActions: number
  }
  salesSummary: string
  revenueTrend: WeeklyPoint[]
  topRecommendations: Recommendation[]
}
