/** /api/search — üst çubuktaki genel arama */
export interface SearchResults {
  query: string
  customers: { id: number; name: string; customerType: string; regionName: string; orders: number; revenue: number; lastOrderDate: string | null }[]
  orders: OrderSummary[]
  products: { id: number; sku: string; name: string; category: string; quantity: number; revenue: number }[]
  categories: { name: string; products: number; revenue: number }[]
  regions: { id: number; name: string; revenue: number }[]
  groups: { kind: 'department' | 'project'; name: string; revenue: number }[]
  /** Aynı açıklama ve türdeki giderler tek satırda */
  expenses: { description: string | null; category: string; project: string | null; count: number; total: number; lastDate: string }[]
  total: number
}

export interface OrderSummary {
  id: number
  orderNo: string | null
  date: string
  status: 'delivered' | 'cancelled'
  customerId: number
  customerName: string
  regionName: string
  department: string | null
  project: string | null
  items: number
  total: number
}

/** /api/orders/:id — tek işlemin ayrıntısı */
export interface OrderDetail extends OrderSummary {
  salesRepName: string | null
  lines: { productId: number; sku: string; name: string; category: string; quantity: number; unitPrice: number; total: number }[]
}
