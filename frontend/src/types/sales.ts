import type { DateWindow, Product, Region } from './common'

export interface ProductComparison {
  product: Product
  currentUnits: number
  previousUnits: number
  unitsChangePct: number | null
  currentRevenue: number
  previousRevenue: number
  revenueDelta: number
  revenueChangePct: number | null
}

export interface RegionComparison {
  region: Region
  currentRevenue: number
  previousRevenue: number
  revenueDelta: number
  revenueChangePct: number | null
  currentOrders: number
  previousOrders: number
}

export interface RevenueExplanation {
  direction: 'up' | 'down' | 'flat'
  revenueDelta: number
  revenueChangePct: number | null
  summary: string
  bullets: string[]
  volumeEffect: number
  priceEffect: number
  lostCustomers: { count: number; previousRevenue: number }
}

export interface SalesTotals {
  revenue: number
  /** Ürün maliyetleri bilinmiyorsa null */
  grossProfit: number | null
  /** Brüt kâr hesabına giren cironun toplam ciroya oranı */
  costCoverage: number
  grossMarginPct: number | null
  units: number
  orders: number
  customers: number
  avgOrderValue: number
}

export interface WeeklyPoint {
  weekStart: string
  weekEnd: string
  revenue: number
  units: number
}

export type MarginStatus = 'loss' | 'low' | 'healthy'

export interface Margin {
  product: Product
  unitsSold: number
  revenue: number
  unitCost: number
  listPrice: number
  avgSellingPrice: number
  avgDiscountPct: number
  marginPct: number
  grossProfit: number
  status: MarginStatus
}

export interface SalesAnalytics {
  asOf: string
  windows: { current: DateWindow; previous: DateWindow }
  totals: { current: SalesTotals; previous: SalesTotals }
  explanation: RevenueExplanation
  products: ProductComparison[]
  regions: RegionComparison[]
  weeklyTrend: WeeklyPoint[]
  margins: Margin[]
}
