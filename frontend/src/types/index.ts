export type * from './assistant'
export type * from './auth'
export type * from './common'
export type * from './customer'
export type * from './data'
export type * from './dashboard'
export type * from './insights'
export type * from './inventory'
export type * from './news'
export type * from './receivables'
export type * from './reports'
export type * from './search'
export type * from './statement'
export type * from './segments'
export type * from './settings'
export type * from './sales'

export interface HealthResponse {
  status: 'ok'
  database: string
  dataAsOf: string | null
  records: Record<string, number>
}

/** /api/config/thresholds — analiz motorunun kullandığı eşikler */
export interface Thresholds {
  RISK_DECLINE_THRESHOLD: number
  HIGH_STOCK_MONTHS: number
  LOW_STOCK_MONTHS: number
  TARGET_STOCK_MONTHS: number
  OPPORTUNITY_GROWTH_THRESHOLD: number
  OPPORTUNITY_MIN_Z_SCORE: number
  CHURN_MULTIPLIER: number
  LOW_MARGIN_THRESHOLD: number
  [name: string]: number
}
