import type { Insight, Product, Region } from './common'
import type { Customer } from './customer'

export type RiskSignal = 'sales_decline' | 'overstock' | 'stockout'

export interface Risk extends Insight {
  kind: 'risk'
  signals: RiskSignal[]
  product: Product
  metrics: {
    currentUnits: number
    previousUnits: number
    /** 0.28 = %28 artış, −0.28 = %28 düşüş; önceki dönemde satış yoksa null */
    salesChangePct: number | null
    currentRevenue: number
    previousRevenue: number
    /** Stok hiç girilmemişse null */
    stockUnits: number | null
    monthlyVelocity: number
    /** Satış yoksa null */
    monthsOfStock: number | null
    excessUnits: number
    shortfallUnits: number
    weakestRegion: { name: string; unitsDelta: number } | null
  }
}

export interface StockTransfer {
  fromRegion: Region
  units: number
  donorStock: number
  donorMonthsOfStock: number | null
}

export interface Opportunity extends Insight {
  kind: 'opportunity'
  product: Product
  region: Region
  metrics: {
    currentUnits: number
    previousUnits: number
    growthPct: number
    baselineGrowthPct: number
    zScore: number | null
    regionStock: number | null
    regionMonthsOfStock: number | null
    unitsNeeded: number
    transfer: StockTransfer | null
  }
}

export interface ChurnRisk extends Insight {
  kind: 'churn'
  customer: Customer
  metrics: {
    orderCount: number
    medianIntervalDays: number
    daysSinceLastOrder: number
    silenceRatio: number
    lastOrderDate: string
    avgMonthlyRevenue: number
    topProducts: string[]
  }
}

export type AnyInsight = Risk | Opportunity | ChurnRisk

export type Priority = 'high' | 'medium' | 'low'

export interface Recommendation {
  id: string
  source: Insight['kind']
  priority: Priority
  priorityScore: number
  title: string
  situation: string
  action: string
  impactAmount: number
  impactLabel: string
  impactShare: number
  entity: { type: 'product' | 'customer'; id: number; name: string }
  regionName: string | null
}

export interface RecommendationsResponse {
  asOf: string
  monthlyRevenue: number
  counts: {
    total: number
    high: number
    medium: number
    low: number
    bySource: { risk: number; opportunity: number; churn: number }
  }
  items: Recommendation[]
}
