import type { Product, Region } from './common'
import type { Risk } from './insights'

/** unknown: ürün için hiç stok bilgisi girilmemiş */
export type CoverageStatus = 'stockout_risk' | 'excess' | 'healthy' | 'inactive' | 'unknown'

export interface StockCell {
  regionId: number
  stock: number | null
  monthlyVelocity: number
  monthsOfStock: number | null
  status: CoverageStatus
}

export interface InventoryProductRow {
  product: Product
  totalStock: number | null
  stockValue: number
  monthlyVelocity: number
  monthsOfStock: number | null
  status: CoverageStatus
  cells: StockCell[]
}

export interface RegionalStockAlert {
  id: string
  product: Product
  region: Region
  status: CoverageStatus
  stock: number
  monthsOfStock: number | null
  message: string
}

export interface InventoryIntelligence {
  asOf: string
  thresholds: { lowStockMonths: number; highStockMonths: number; targetStockMonths: number }
  summary: {
    totalUnits: number
    totalValue: number
    excessValue: number
    statusCounts: { stockoutRisk: number; excess: number; healthy: number; inactive: number; unknown: number }
  }
  alerts: Risk[]
  regionalAlerts: RegionalStockAlert[]
  regions: Region[]
  products: InventoryProductRow[]
}
