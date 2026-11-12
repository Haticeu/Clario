/** Veri yönetimi kayıtları (backend/src/data/entities.ts ile birebir). */

export interface RegionRecord {
  id: number
  name: string
  customerCount: number
}

export interface ProductRecord {
  id: number
  sku: string
  name: string
  category: string
  unitCost: number
  listPrice: number
  totalStock: number
}

export interface EmployeeRecord {
  id: number
  fullName: string
  role: string
  regionId: number | null
  regionName: string | null
  monthlySalary: number
  hireDate: string
}

export interface CustomerRecord {
  id: number
  name: string
  customerType: 'Bayi' | 'Mağaza'
  regionId: number
  regionName: string
  salesRepId: number | null
  salesRepName: string | null
  orderCount: number
  lastOrderDate: string | null
  taxId: string | null
  paymentTermDays: number | null
  creditLimit: number | null
}

export interface OrderRecord {
  id: number
  orderNo: string | null
  orderDate: string
  status: 'delivered' | 'cancelled'
  customerId: number
  customerName: string
  regionName: string
  department: string | null
  project: string | null
  itemCount: number
  totalAmount: number
}

export interface OrderItemRecord {
  productId: number
  productName: string
  sku: string
  quantity: number
  unitPrice: number
}

export interface InventoryRecord {
  productId: number
  regionId: number
  quantity: number
}

export interface ExpenseRecord {
  id: number
  expenseDate: string
  category: string
  amount: number
  regionId: number | null
  regionName: string | null
  description: string | null
  department: string | null
  project: string | null
  supplier: string | null
  dueDate: string | null
  paidDate: string | null
  invoiceNo: string | null
  invoiceTotal: number | null
}

/** Tahsilat (cari hesap) */
export interface PaymentRecord {
  id: number
  customerId: number
  customerName: string
  paymentDate: string
  amount: number
  method: string | null
  reference: string | null
  description: string | null
}

export type ResourceName = 'regions' | 'products' | 'employees' | 'customers' | 'expenses' | 'payments'

export interface ResourceRecords {
  regions: RegionRecord
  products: ProductRecord
  employees: EmployeeRecord
  customers: CustomerRecord
  expenses: ExpenseRecord
  payments: PaymentRecord
}

// ── Excel içe aktarma raporu ──

export type ImportMode = 'merge' | 'replace'

export interface ImportIssue {
  sheet: string
  row: number | null
  /** Hatanın ilgili olduğu alan (ör. "orderDate"); gruplamak için */
  field?: string
  message: string
}

interface Tally {
  created: number
  updated: number
}

export interface ImportReport {
  mode: ImportMode
  committed: boolean
  ok: boolean
  sheets: { key: string; title: string; sheetName: string; rows: number }[]
  counts: {
    regions: Tally
    products: Tally
    employees: Tally
    customers: Tally
    orders: Tally
    orderItems: number
    inventory: number
    expenses: { created: number; skipped: number }
    payments?: { created: number; skipped: number }
  }
  errors: ImportIssue[]
  warnings: ImportIssue[]
  truncated: boolean
  /** Hatalı veri satırı sayısı (liste kısaltılmış olsa bile tam sayı) */
  rowErrors: number
  /** skipInvalid ile atlanan hatalı satır sayısı */
  skippedRows: number
}

// ── Sütun eşleştirme (kullanıcının kendi tabloları) ──

export type SheetKey = 'regions' | 'products' | 'employees' | 'customers' | 'sales' | 'inventory' | 'expenses'

export interface SheetAnalysis {
  name: string
  type: SheetKey | null
  headerRow: number
  rowCount: number
  columns: { index: number; header: string; samples: string[] }[]
  /** Her veri türü için önerilen eşleştirme: sütun sırası → alan */
  suggestions: Record<SheetKey, Record<string, string>>
}

export interface ImportTypeInfo {
  key: SheetKey
  title: string
  fields: { key: string; label: string; required: boolean }[]
  requireAny: string[][]
}

export interface ImportAnalysis {
  sheets: SheetAnalysis[]
  types: ImportTypeInfo[]
}

export interface ImportMapping {
  sheets: { name: string; type: SheetKey | null; headerRow: number; columns: Record<string, string> }[]
}