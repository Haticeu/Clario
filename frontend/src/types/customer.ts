import type { Region } from './common'
import type { ChurnRisk } from './insights'

export type CustomerType = 'Bayi' | 'Mağaza'
export type CustomerStatus = 'active' | 'watch' | 'churn_risk' | 'insufficient_data'
export type Segment = 'A' | 'B' | 'C'

export interface Customer {
  id: number
  name: string
  type: CustomerType
  region: Region
  salesRepName: string | null
}

export interface CustomerActivity {
  customer: Customer
  segment: Segment
  orderCount: number
  firstOrderDate: string | null
  lastOrderDate: string | null
  medianIntervalDays: number | null
  daysSinceLastOrder: number | null
  silenceRatio: number | null
  status: CustomerStatus
  totalRevenue: number
  avgMonthlyRevenue: number
}

export interface SegmentSummary {
  segment: Segment
  label: string
  customerCount: number
  revenue: number
  revenueShare: number
  churnRiskCount: number
}

export interface CustomerAnalysis {
  asOf: string
  summary: {
    totalCustomers: number
    activeCustomers: number
    active: number
    watch: number
    churnRisk: number
    insufficientData: number
    monthlyRevenueAtRisk: number
  }
  thresholds: { churnSilenceMultiplier: number; watchMultiplier: number; minOrders: number }
  segments: SegmentSummary[]
  byType: { type: CustomerType; customerCount: number; revenue: number }[]
  churnRisks: ChurnRisk[]
  customers: CustomerActivity[]
}
