import type { DbClient } from '../db/types.js';
import { getBaseCurrency, getSetting, setSetting } from '../repositories/settingsRepository.js';
import { addDays, daysBetween } from '../utils/dates.js';
import { round } from '../utils/stats.js';
import { localDate, type ReportNotice } from './statement.js';

/**
 * Cari hesap ve alacak takibi. Faturalar (teslim edilen siparişler) borç, tahsilatlar alacak yazılır; tahsilatlar
 * müşterinin en eski vadeli faturasından başlayarak mahsup edilir (FIFO). Kalan açık tutarlar vade gününe göre
 * yaşlandırılır. Tedarikçi borçları ödenmemiş gider faturalarından gelir.
 *
 * Tutarlar verilerin para biriminde (cari hesap kur farkıyla değişmez). Takip başlangıç tarihinden önceki faturalar
 * ve tahsilatlar hesaba katılmaz (geçmiş satışlar kapanmış sayılır).
 */

export interface ReceivableSettings {
  /** Takip başlangıcı; null: henüz kurulmadı */
  startDate: string | null;
  /** Faturada ve müşteride vade yoksa: fatura tarihinden itibaren gün */
  defaultTermDays: number;
  /** e-Fatura giden/gelen ayrımı için firmamızın VKN/TCKN'si */
  companyTaxId: string | null;
}

const KEYS = { start: 'ar_start_date', term: 'ar_default_term_days', company: 'company_tax_id' } as const;
const DEFAULT_TERM = 30;

export async function getReceivableSettings(db: DbClient): Promise<ReceivableSettings> {
  const [start, term, company] = await Promise.all([getSetting(db, KEYS.start), getSetting(db, KEYS.term), getSetting(db, KEYS.company)]);
  const days = Number(term);
  return { startDate: start, defaultTermDays: term !== null && Number.isInteger(days) && days >= 0 ? days : DEFAULT_TERM, companyTaxId: company };
}

export async function saveReceivableSettings(db: DbClient, settings: ReceivableSettings): Promise<void> {
  if (settings.startDate) await setSetting(db, KEYS.start, settings.startDate);
  await setSetting(db, KEYS.term, String(settings.defaultTermDays));
  if (settings.companyTaxId !== null) await setSetting(db, KEYS.company, settings.companyTaxId);
}

export type AgingBucket = 'current' | 'd1_30' | 'd31_60' | 'd61_90' | 'd90plus';
export const AGING_LABELS: Record<AgingBucket, string> = {
  current: 'Vadesi gelmemiş',
  d1_30: '1–30 gün',
  d31_60: '31–60 gün',
  d61_90: '61–90 gün',
  d90plus: '90+ gün',
};
const emptyAging = (): Record<AgingBucket, number> => ({ current: 0, d1_30: 0, d31_60: 0, d61_90: 0, d90plus: 0 });

function bucketOf(daysOverdue: number): AgingBucket {
  if (daysOverdue <= 0) return 'current';
  if (daysOverdue <= 30) return 'd1_30';
  if (daysOverdue <= 60) return 'd31_60';
  if (daysOverdue <= 90) return 'd61_90';
  return 'd90plus';
}

export interface OpenInvoice {
  orderId: number;
  orderNo: string | null;
  date: string;
  dueDate: string;
  amount: number;
  open: number;
  daysOverdue: number;
}

export interface CustomerReceivable {
  customerId: number;
  name: string;
  regionName: string;
  salesRepName: string | null;
  taxId: string | null;
  /** Bakiye: açık faturalar − fazla ödeme (eksi: müşterinin avansı var) */
  balance: number;
  overdue: number;
  aging: Record<AgingBucket, number>;
  oldestOverdueDays: number;
  openInvoices: number;
  nextDueDate: string | null;
  lastPaymentDate: string | null;
  creditLimit: number | null;
  overLimit: boolean;
}

export interface SupplierPayable {
  supplier: string;
  balance: number;
  overdue: number;
  invoices: { expenseId: number; invoiceNo: string | null; date: string; dueDate: string; amount: number; daysOverdue: number; description: string | null }[];
}

export interface ReceivablesReport {
  setupRequired: boolean;
  settings: ReceivableSettings;
  asOf: string;
  currency: string;
  summary: {
    totalReceivable: number;
    overdue: number;
    overdueCustomers: number;
    aging: Record<AgingBucket, number>;
    dueNext7: number;
    dueNext30: number;
    collectedLast30: number;
    /** Ortalama tahsil süresi (gün): alacak ÷ son 90 günün günlük ortalama satışı */
    dso: number | null;
    overLimitCustomers: number;
    totalPayable: number;
    overduePayable: number;
    payableNext7: number;
    payableNext30: number;
  };
  /** Önümüzdeki 30 gün: beklenen tahsilat ve ödenecek borçlar (vade gününe göre) */
  outlook: { week: string; collections: number; payments: number }[];
  customers: CustomerReceivable[];
  suppliers: SupplierPayable[];
}

interface InvoiceRow {
  orderId: number;
  orderNo: string | null;
  customerId: number;
  date: string;
  dueDate: string | null;
  invoiceTotal: number | null;
  netTotal: number;
  termDays: number | null;
}

/** Müşterinin faturaları (vade sırasıyla) ve tahsilatlarıyla FIFO mahsup */
function settle(invoices: InvoiceRow[], paid: number, defaultTerm: number, today: string) {
  const sorted = invoices
    .map((inv) => {
      const amount = round(Number(inv.invoiceTotal ?? inv.netTotal), 2);
      const dueDate = inv.dueDate ?? addDays(inv.date, inv.termDays ?? defaultTerm);
      return { inv, amount, dueDate };
    })
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.inv.date.localeCompare(b.inv.date));
  let remaining = paid;
  const open: OpenInvoice[] = [];
  for (const { inv, amount, dueDate } of sorted) {
    const applied = Math.min(remaining, amount);
    remaining = round(remaining - applied, 2);
    const left = round(amount - applied, 2);
    if (left > 0.004) {
      open.push({ orderId: inv.orderId, orderNo: inv.orderNo, date: inv.date, dueDate, amount, open: left, daysOverdue: Math.max(0, daysBetween(dueDate, today)) });
    }
  }
  return { open, credit: remaining };
}

async function loadInvoices(db: DbClient, startDate: string, customerId?: number): Promise<InvoiceRow[]> {
  return db.query<InvoiceRow>(
    `SELECT o.id AS "orderId", o.order_no AS "orderNo", o.customer_id AS "customerId", o.order_date AS date,
            o.due_date AS "dueDate", o.invoice_total AS "invoiceTotal", c.payment_term_days AS "termDays",
            COALESCE((SELECT SUM(oi.quantity * oi.unit_price) FROM order_items oi WHERE oi.order_id = o.id), 0) AS "netTotal"
     FROM orders o JOIN customers c ON c.id = o.customer_id
     WHERE o.status = 'delivered' AND o.order_date >= ? ${customerId ? 'AND o.customer_id = ?' : ''}
     ORDER BY o.order_date, o.id`,
    customerId ? [startDate, customerId] : [startDate],
  );
}

export async function getReceivables(db: DbClient, now = new Date()): Promise<ReceivablesReport> {
  const [settings, currency] = await Promise.all([getReceivableSettings(db), getBaseCurrency(db)]);
  const today = localDate(now);
  const empty: ReceivablesReport = {
    setupRequired: settings.startDate === null,
    settings,
    asOf: today,
    currency,
    summary: {
      totalReceivable: 0, overdue: 0, overdueCustomers: 0, aging: emptyAging(), dueNext7: 0, dueNext30: 0, collectedLast30: 0,
      dso: null, overLimitCustomers: 0, totalPayable: 0, overduePayable: 0, payableNext7: 0, payableNext30: 0,
    },
    outlook: [],
    customers: [],
    suppliers: [],
  };
  if (!settings.startDate) return empty;
  const start = settings.startDate;

  const [invoices, paymentRows, customers, collected, sales90, expenseRows] = await Promise.all([
    loadInvoices(db, start),
    db.query<{ customerId: number; paid: number; last: string }>(
      `SELECT customer_id AS "customerId", SUM(amount) AS paid, MAX(payment_date) AS last FROM payments WHERE payment_date >= ? GROUP BY customer_id`,
      [start],
    ),
    db.query<{ id: number; name: string; regionName: string; salesRepName: string | null; taxId: string | null; creditLimit: number | null }>(
      `SELECT c.id, c.name, r.name AS "regionName", e.full_name AS "salesRepName", c.tax_id AS "taxId", c.credit_limit AS "creditLimit"
       FROM customers c JOIN regions r ON r.id = c.region_id LEFT JOIN employees e ON e.id = c.sales_rep_id`,
    ),
    db.queryOne<{ total: number }>('SELECT COALESCE(SUM(amount), 0) AS total FROM payments WHERE payment_date > ? AND payment_date <= ?', [addDays(today, -30), today]),
    db.queryOne<{ total: number }>(
      `SELECT COALESCE(SUM(COALESCE(o.invoice_total, (SELECT SUM(oi.quantity * oi.unit_price) FROM order_items oi WHERE oi.order_id = o.id))), 0) AS total
       FROM orders o WHERE o.status = 'delivered' AND o.order_date > ? AND o.order_date <= ?`,
      [addDays(today, -90), today],
    ),
    db.query<{ id: number; supplier: string | null; date: string; dueDate: string | null; amount: number; invoiceTotal: number | null; invoiceNo: string | null; description: string | null }>(
      `SELECT id, supplier, expense_date AS date, due_date AS "dueDate", amount, invoice_total AS "invoiceTotal", invoice_no AS "invoiceNo", description
       FROM expenses WHERE paid_date IS NULL AND expense_date >= ? AND (supplier IS NOT NULL OR due_date IS NOT NULL OR invoice_no IS NOT NULL)`,
      [start],
    ),
  ]);

  const byCustomer = new Map<number, InvoiceRow[]>();
  for (const inv of invoices) byCustomer.set(inv.customerId, [...(byCustomer.get(inv.customerId) ?? []), inv]);
  const payments = new Map(paymentRows.map((p) => [p.customerId, p]));
  const report = { ...empty, setupRequired: false };
  const s = report.summary;
  const flows = new Map<string, { collections: number; payments: number }>();
  const weekOf = (date: string) => {
    const offset = Math.max(0, daysBetween(today, date));
    return `${Math.floor(offset / 7)}`;
  };
  const addFlow = (date: string, kind: 'collections' | 'payments', amount: number) => {
    if (daysBetween(today, date) > 30) return;
    const key = weekOf(date);
    const entry = flows.get(key) ?? { collections: 0, payments: 0 };
    entry[kind] += amount;
    flows.set(key, entry);
  };

  for (const customer of customers) {
    const rows = byCustomer.get(customer.id) ?? [];
    const payment = payments.get(customer.id);
    if (rows.length === 0 && !payment) continue;
    const { open, credit } = settle(rows, Number(payment?.paid ?? 0), settings.defaultTermDays, today);
    const aging = emptyAging();
    for (const inv of open) aging[bucketOf(inv.daysOverdue)] += inv.open;
    const balance = round(open.reduce((sum, inv) => sum + inv.open, 0) - credit, 2);
    const overdue = round(open.filter((inv) => inv.daysOverdue > 0).reduce((sum, inv) => sum + inv.open, 0), 2);
    const limit = customer.creditLimit === null ? null : Number(customer.creditLimit);
    const row: CustomerReceivable = {
      customerId: customer.id,
      name: customer.name,
      regionName: customer.regionName,
      salesRepName: customer.salesRepName,
      taxId: customer.taxId,
      balance,
      overdue,
      aging: Object.fromEntries(Object.entries(aging).map(([k, v]) => [k, round(v, 2)])) as Record<AgingBucket, number>,
      oldestOverdueDays: Math.max(0, ...open.map((inv) => inv.daysOverdue)),
      openInvoices: open.length,
      nextDueDate: open.filter((inv) => inv.daysOverdue === 0).map((inv) => inv.dueDate).sort()[0] ?? null,
      lastPaymentDate: payment?.last ?? null,
      creditLimit: limit,
      overLimit: limit !== null && limit > 0 && balance > limit,
    };
    if (balance === 0 && overdue === 0 && row.openInvoices === 0 && credit === 0) continue;
    report.customers.push(row);

    s.totalReceivable += Math.max(0, balance);
    s.overdue += overdue;
    if (overdue > 0) s.overdueCustomers++;
    if (row.overLimit) s.overLimitCustomers++;
    for (const key of Object.keys(aging) as AgingBucket[]) s.aging[key] += aging[key];
    for (const inv of open) {
      const days = daysBetween(today, inv.dueDate);
      if (days >= 0 && days <= 7) s.dueNext7 += inv.open;
      if (days >= 0 && days <= 30) s.dueNext30 += inv.open;
      // Vadesi geçmiş alacak bu hafta beklenir
      addFlow(days < 0 ? today : inv.dueDate, 'collections', inv.open);
    }
  }

  // Tedarikçi borçları (ödenmemiş gider faturaları)
  const suppliers = new Map<string, SupplierPayable>();
  for (const x of expenseRows) {
    const name = x.supplier ?? 'Tedarikçi belirtilmemiş';
    const amount = round(Number(x.invoiceTotal ?? x.amount), 2);
    const dueDate = x.dueDate ?? addDays(x.date, settings.defaultTermDays);
    const daysOverdue = Math.max(0, daysBetween(dueDate, today));
    const entry = suppliers.get(name) ?? { supplier: name, balance: 0, overdue: 0, invoices: [] };
    entry.balance = round(entry.balance + amount, 2);
    if (daysOverdue > 0) entry.overdue = round(entry.overdue + amount, 2);
    entry.invoices.push({ expenseId: x.id, invoiceNo: x.invoiceNo, date: x.date, dueDate, amount, daysOverdue, description: x.description });
    suppliers.set(name, entry);
    s.totalPayable += amount;
    if (daysOverdue > 0) s.overduePayable += amount;
    const days = daysBetween(today, dueDate);
    if (days >= 0 && days <= 7) s.payableNext7 += amount;
    if (days >= 0 && days <= 30) s.payableNext30 += amount;
    addFlow(days < 0 ? today : dueDate, 'payments', amount);
  }

  report.customers.sort((a, b) => b.overdue - a.overdue || b.balance - a.balance);
  report.suppliers = [...suppliers.values()].sort((a, b) => b.overdue - a.overdue || b.balance - a.balance);
  for (const sup of report.suppliers) sup.invoices.sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  s.collectedLast30 = round(Number(collected?.total ?? 0), 2);
  const dailySales = Number(sales90?.total ?? 0) / 90;
  s.dso = dailySales > 0 ? Math.round(s.totalReceivable / dailySales) : null;
  for (const key of ['totalReceivable', 'overdue', 'dueNext7', 'dueNext30', 'totalPayable', 'overduePayable', 'payableNext7', 'payableNext30'] as const) {
    s[key] = round(s[key], 2);
  }
  for (const key of Object.keys(s.aging) as AgingBucket[]) s.aging[key] = round(s.aging[key], 2);
  report.outlook = [0, 1, 2, 3, 4].map((w) => {
    const flow = flows.get(String(w)) ?? { collections: 0, payments: 0 };
    return { week: addDays(today, w * 7), collections: round(flow.collections, 2), payments: round(flow.payments, 2) };
  });
  return report;
}

// ── Cari hesap ekstresi (müşteri) ──

export interface LedgerEntry {
  date: string;
  kind: 'invoice' | 'payment';
  reference: string | null;
  description: string;
  debit: number;
  credit: number;
  balance: number;
  dueDate: string | null;
}

export interface CustomerLedger {
  customer: { id: number; name: string; taxId: string | null; regionName: string; paymentTermDays: number | null; creditLimit: number | null };
  currency: string;
  startDate: string;
  asOf: string;
  entries: LedgerEntry[];
  openInvoices: OpenInvoice[];
  balance: number;
  overdue: number;
}

export async function getCustomerLedger(db: DbClient, customerId: number, now = new Date()): Promise<CustomerLedger | null> {
  const customer = await db.queryOne<CustomerLedger['customer']>(
    `SELECT c.id, c.name, c.tax_id AS "taxId", r.name AS "regionName", c.payment_term_days AS "paymentTermDays", c.credit_limit AS "creditLimit"
     FROM customers c JOIN regions r ON r.id = c.region_id WHERE c.id = ?`,
    [customerId],
  );
  if (!customer) return null;
  const [settings, currency] = await Promise.all([getReceivableSettings(db), getBaseCurrency(db)]);
  const start = settings.startDate ?? '0000-01-01';
  const today = localDate(now);
  const [invoices, payments] = await Promise.all([
    loadInvoices(db, start, customerId),
    db.query<{ date: string; amount: number; method: string | null; reference: string | null; description: string | null }>(
      'SELECT payment_date AS date, amount, method, reference, description FROM payments WHERE customer_id = ? AND payment_date >= ? ORDER BY payment_date, id',
      [customerId, start],
    ),
  ]);
  const raw: Omit<LedgerEntry, 'balance'>[] = [
    ...invoices.map((inv) => ({
      date: inv.date,
      kind: 'invoice' as const,
      reference: inv.orderNo,
      description: 'Satış faturası',
      debit: round(Number(inv.invoiceTotal ?? inv.netTotal), 2),
      credit: 0,
      dueDate: inv.dueDate ?? addDays(inv.date, inv.termDays ?? settings.defaultTermDays),
    })),
    ...payments.map((p) => ({
      date: p.date,
      kind: 'payment' as const,
      reference: p.reference,
      description: ['Tahsilat', p.method, p.description].filter(Boolean).join(' · '),
      debit: 0,
      credit: round(Number(p.amount), 2),
      dueDate: null,
    })),
  ].sort((a, b) => a.date.localeCompare(b.date) || (a.kind === 'invoice' ? -1 : 1));
  let balance = 0;
  const entries = raw.map((e) => {
    balance = round(balance + e.debit - e.credit, 2);
    return { ...e, balance };
  });
  const { open } = settle(invoices, payments.reduce((sum, p) => sum + Number(p.amount), 0), settings.defaultTermDays, today);
  return {
    customer: { ...customer, creditLimit: customer.creditLimit === null ? null : Number(customer.creditLimit) },
    currency,
    startDate: start,
    asOf: today,
    entries,
    openInvoices: open,
    balance,
    overdue: round(open.filter((i) => i.daysOverdue > 0).reduce((sum, i) => sum + i.open, 0), 2),
  };
}

/**
 * Zil bildirimleri (haftada bir, pazartesi): vadesi geçen alacaklar ve bu hafta ödenecek borçlar. Takip kurulmadıysa
 * bildirim yoktur.
 */
export async function getReceivableNotices(db: DbClient, now = new Date()): Promise<ReportNotice[]> {
  const report = await getReceivables(db, now);
  if (report.setupRequired) return [];
  const money = new Intl.NumberFormat('tr-TR', { style: 'currency', currency: report.currency, maximumFractionDigits: 0 });
  const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - ((now.getDay() + 6) % 7), 9, 0, 0);
  const at = (monday > now ? new Date(monday.getTime() - 7 * 86_400_000) : monday).toISOString();
  const week = localDate(new Date(at));
  const notices: ReportNotice[] = [];
  const s = report.summary;
  if (s.overdue > 0) {
    notices.push({
      id: `ar-overdue-${week}`,
      kind: 'receivables',
      title: `Vadesi geçen alacak: ${money.format(s.overdue)}`,
      body: `${s.overdueCustomers} müşteri · en büyük: ${report.customers[0]?.name ?? '—'}${s.overLimitCustomers ? ` · ${s.overLimitCustomers} müşteri kredi limitini aştı` : ''}`,
      query: { kind: 'receivables', tab: 'customers' },
      availableAt: at,
    });
  }
  if (s.payableNext7 > 0 || s.overduePayable > 0) {
    notices.push({
      id: `ap-due-${week}`,
      kind: 'receivables',
      title: `Bu hafta ödenecek borç: ${money.format(s.payableNext7 + s.overduePayable)}`,
      body: s.overduePayable > 0 ? `${money.format(s.overduePayable)} tutarı vadesi geçmiş` : 'Tedarikçi faturaları',
      query: { kind: 'receivables', tab: 'suppliers' },
      availableAt: at,
    });
  }
  return notices;
}
