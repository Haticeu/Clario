import type { DateWindow } from './common'

export type SegmentDimension = 'department' | 'project'

export interface SegmentFigures {
  revenue: number
  productCost: number
  expenses: number
  /** Ciro − ürün maliyeti − giderler */
  net: number
  /** Ciro içinde maliyeti bilinen ürünlerin payı (0–1) */
  costCoverage: number
  orders: number
}

export interface SegmentRow {
  /** null: departman/proje girilmemiş kayıtlar */
  name: string | null
  current: SegmentFigures
  previousRevenue: number
  revenueChangePct: number | null
  allTime: SegmentFigures
}

export interface SegmentAlert {
  dimension: SegmentDimension
  name: string
  severity: 'high' | 'medium'
  message: string
}

interface SegmentCoverage {
  count: number
  revenueShare: number
  expenseShare: number
}

/** GET /api/segments */
export interface SegmentAnalysis {
  asOf: string
  windows: { current: DateWindow; previous: DateWindow }
  departments: SegmentRow[]
  projects: SegmentRow[]
  alerts: SegmentAlert[]
  coverage: { departments: SegmentCoverage; projects: SegmentCoverage }
}
