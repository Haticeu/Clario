export type AgingBucket = 'current' | 'd1_30' | 'd31_60' | 'd61_90' | 'd90plus'

export interface ReceivableSettings {
  startDate: string | null
  defaultTermDays: number
  companyTaxId: string | null
}

export interface CustomerReceivable {
  customerId: number
  name: string
  regionName: string
  salesRepName: string | null
  taxId: string | null
  balance: number
  overdue: number
  aging: Record<AgingBucket, number>
  oldestOverdueDays: number
  openInvoices: number
  nextDueDate: string | null
  lastPaymentDate: string | null
  creditLimit: number | null
  overLimit: boolean
}

export interface SupplierPayable {
  supplier: string
  balance: number
  overdue: number
  invoices: { expenseId: number; invoiceNo: string | null; date: string; dueDate: string; amount: number; daysOverdue: number; description: string | null }[]
}

/** GET /api/receivables */
export interface ReceivablesReport {
  setupRequired: boolean
  settings: ReceivableSettings
  asOf: string
  currency: string
  summary: {
    totalReceivable: number
    overdue: number
    overdueCustomers: number
    aging: Record<AgingBucket, number>
    dueNext7: number
    dueNext30: number
    collectedLast30: number
    dso: number | null
    overLimitCustomers: number
    totalPayable: number
    overduePayable: number
    payableNext7: number
    payableNext30: number
  }
  outlook: { week: string; collections: number; payments: number }[]
  customers: CustomerReceivable[]
  suppliers: SupplierPayable[]
}

export interface LedgerEntry {
  date: string
  kind: 'invoice' | 'payment'
  reference: string | null
  description: string
  debit: number
  credit: number
  balance: number
  dueDate: string | null
}

/** GET /api/receivables/customers/:id — cari hesap ekstresi */
export interface CustomerLedger {
  customer: { id: number; name: string; taxId: string | null; regionName: string; paymentTermDays: number | null; creditLimit: number | null }
  currency: string
  startDate: string
  asOf: string
  entries: LedgerEntry[]
  openInvoices: { orderId: number; orderNo: string | null; date: string; dueDate: string; amount: number; open: number; daysOverdue: number }[]
  balance: number
  overdue: number
}
