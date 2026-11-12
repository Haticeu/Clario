/** Backend'in döndürdüğü ortak yapılar (backend/src/analysis/types.ts ile birebir). */

export type Severity = 'high' | 'medium' | 'low'
export type InsightKind = 'risk' | 'opportunity' | 'churn'

export interface Product {
  id: number
  sku: string
  name: string
  category: string
}

export interface Region {
  id: number
  name: string
}

/** Yarı açık tarih aralığı (from, to], ISO 'YYYY-MM-DD'. */
export interface DateWindow {
  from: string
  to: string
}

/** Risk, fırsat ve kayıp riskinin ortak biçimi: durum → öneri → etki. */
export interface Insight {
  id: string
  kind: InsightKind
  severity: Severity
  title: string
  message: string
  recommendation: string
  impactAmount: number
  impactLabel: string
}

export interface ListResponse<T> {
  asOf: string
  count: number
  items: T[]
}

export interface ApiErrorBody {
  error: { message: string }
}
