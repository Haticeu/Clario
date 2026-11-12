import { fxFactor } from '../currency/money.js';
import type { DbClient } from '../db/types.js';
import { getReportOrders, getReportTotals, type Period, type ReportFilter, type ReportOrderRow } from '../repositories/reportRepository.js';
import { getSetting, setSetting } from '../repositories/settingsRepository.js';
import { addDays, daysBetween } from '../utils/dates.js';
import { formatCurrency, formatDate, formatNumber, formatPercent } from '../utils/format.js';
import { round } from '../utils/stats.js';
import { getReport, type BreakdownRow, type ReportTotals } from './reports.js';

/**
 * Ekstre ve dönem raporları: aylık ekstre (her ayın 1'inde bir önceki ay), gün sonu raporu ve istenen tarih
 * aralığı için genel rapor. Hepsi aynı yapıyı döner; PDF (arayüzde) ve Excel (export.xlsx) bu yapıdan üretilir.
 */

export type StatementKind = 'monthly' | 'daily' | 'range';

export interface Statement {
  kind: StatementKind;
  title: string;
  period: Period & { days: number };
  previousPeriod: Period;
  generatedAt: string;
  business: { name: string | null; email: string | null };
  totals: ReportTotals;
  previousTotals: ReportTotals;
  changes: { revenue: number | null; orders: number | null; customers: number | null; avgOrderValue: number | null };
  expenses: number;
  netContribution: number;
  cancelled: { orders: number; amount: number };
  newCustomers: number;
  /** Günlük satırlar (gün sonu raporunda tek gün) */
  days: { date: string; orders: number; units: number; revenue: number }[];
  categories: BreakdownRow[];
  products: BreakdownRow[];
  customers: BreakdownRow[];
  regions: BreakdownRow[];
  projects: BreakdownRow[];
  expenseCategories: { category: string; amount: number; count: number }[];
  /** Dönemin tüm işlemleri (en yeniden eskiye; çok fazlaysa ilk MAX_ORDERS) */
  orders: ReportOrderRow[];
  ordersTotal: number;
  highlights: string[];
}

const MAX_ORDERS = 1000;
const TOP = 10;
const MONTHS = ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'];

const pad = (n: number) => String(n).padStart(2, '0');

/** Cihazın/sunucunun yerel saatine göre YYYY-AA-GG (ekstre günleri kullanıcının takvimine göre) */
export function localDate(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function monthPeriod(month: string): Period {
  const [y, m] = month.split('-').map(Number) as [number, number];
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { from: `${month}-01`, to: `${month}-${pad(last)}` };
}

export const monthLabel = (month: string) => `${MONTHS[Number(month.slice(5, 7)) - 1]} ${month.slice(0, 4)}`;
const dayLabel = (date: string) => `${Number(date.slice(8, 10))} ${MONTHS[Number(date.slice(5, 7)) - 1]} ${date.slice(0, 4)}`;

export function statementTitle(kind: StatementKind, period: Period): string {
  if (kind === 'monthly') return `${monthLabel(period.from.slice(0, 7))} ekstresi`;
  if (kind === 'daily') return `Gün sonu raporu · ${dayLabel(period.from)}`;
  return `Dönem raporu · ${formatDate(period.from)} – ${formatDate(period.to)}`;
}

function highlights(s: Omit<Statement, 'highlights'>): string[] {
  const out: string[] = [];
  if (s.totals.orders === 0) {
    out.push(s.kind === 'daily' ? 'Bu gün kaydedilmiş satış yok.' : 'Bu dönemde kaydedilmiş satış yok.');
    if (s.expenses > 0) out.push(`Dönem giderleri: ${formatCurrency(s.expenses)}.`);
    return out;
  }
  const change = s.changes.revenue;
  const compared = s.kind === 'monthly' ? 'önceki aya' : s.kind === 'daily' ? 'önceki güne' : 'önceki eşit döneme';
  out.push(
    `Ciro ${formatCurrency(s.totals.revenue)}, ${formatNumber(s.totals.orders)} sipariş` +
      (change === null ? '.' : `; ${compared} göre ${formatPercent(change)} ${change >= 0 ? 'artış' : 'düşüş'}.`),
  );
  if (s.totals.grossMarginPct !== null) out.push(`Brüt kâr ${formatCurrency(s.totals.grossProfit ?? 0)} (marj ${formatPercent(s.totals.grossMarginPct)}).`);
  if (s.expenses > 0) out.push(`Giderler ${formatCurrency(s.expenses)}; net katkı ${formatCurrency(s.netContribution)}.`);
  const best = [...s.days].sort((a, b) => b.revenue - a.revenue)[0];
  if (best && s.days.length > 1 && best.revenue > 0) out.push(`En yüksek satış günü ${formatDate(best.date)} (${formatCurrency(best.revenue)}).`);
  const product = s.products[0];
  if (product?.name) out.push(`En çok satan ürün: ${product.name} (${formatCurrency(product.revenue)}, payı ${formatPercent(product.share)}).`);
  const customer = s.customers[0];
  if (customer?.name) out.push(`En büyük müşteri: ${customer.name} (${formatCurrency(customer.revenue)}).`);
  if (s.newCustomers > 0) out.push(`${formatNumber(s.newCustomers)} yeni müşteri ilk siparişini verdi.`);
  if (s.cancelled.orders > 0) out.push(`${formatNumber(s.cancelled.orders)} sipariş iptal edildi (${formatCurrency(s.cancelled.amount)}).`);
  const falling = s.products.filter((p) => p.changePct !== null && p.changePct <= -0.25 && p.previousRevenue > 0)[0];
  if (falling?.name && s.kind !== 'daily') out.push(`Dikkat: ${falling.name} satışları ${formatPercent(falling.changePct!)} düştü.`);
  return out;
}

export async function buildStatement(db: DbClient, kind: StatementKind, period: Period, now = new Date()): Promise<Statement> {
  const delivered: ReportFilter = { status: 'delivered' };
  const [report, cancelled, orders, newCustomers, expenseCategories, name, email] = await Promise.all([
    getReport(db, delivered, period),
    getReportTotals(db, { status: 'cancelled' }, period),
    getReportOrders(db, { status: 'all' }, period, MAX_ORDERS, 0),
    db.queryOne<{ n: number }>(
      `SELECT COUNT(*) AS n FROM (SELECT customer_id, MIN(order_date) AS first FROM orders WHERE status = 'delivered' GROUP BY customer_id)
       WHERE first >= ? AND first <= ?`,
      [period.from, period.to],
    ),
    db.query<{ category: string; amount: number; count: number }>(
      `SELECT category, SUM(amount * ${fxFactor('expense_date')}) AS amount, COUNT(*) AS count
       FROM expenses WHERE expense_date >= ? AND expense_date <= ? GROUP BY category ORDER BY amount DESC`,
      [period.from, period.to],
    ),
    getSetting(db, 'profile_name'),
    getSetting(db, 'profile_email'),
  ]);
  const dailyRows = report.series.granularity === 'day' ? report.series.points : [];
  // Gün sonu dışında günlük döküm her zaman gün gün (uzun aralıklarda grafik haftalık olsa da)
  const days =
    kind === 'daily'
      ? [{ date: period.from, orders: report.totals.orders, units: report.totals.units, revenue: report.totals.revenue }]
      : dailyRows.length > 0
        ? dailyRows.map((p) => ({ date: p.start, orders: p.orders, units: p.units, revenue: p.revenue }))
        : [];

  const base: Omit<Statement, 'highlights'> = {
    kind,
    title: statementTitle(kind, period),
    period: report.period,
    previousPeriod: report.previousPeriod,
    generatedAt: now.toISOString(),
    business: { name, email },
    totals: report.totals,
    previousTotals: report.previousTotals,
    changes: {
      revenue: report.changes.revenue,
      orders: report.changes.orders,
      customers: report.changes.customers,
      avgOrderValue: report.changes.avgOrderValue,
    },
    expenses: report.expenses ?? 0,
    netContribution: report.netContribution ?? 0,
    cancelled: { orders: cancelled.orders, amount: round(cancelled.revenue) },
    newCustomers: newCustomers?.n ?? 0,
    days,
    categories: report.breakdowns.category.slice(0, TOP),
    products: report.breakdowns.product.slice(0, TOP),
    customers: report.breakdowns.customer.slice(0, TOP),
    regions: report.breakdowns.region.slice(0, TOP),
    projects: report.breakdowns.project.filter((p) => p.name).slice(0, TOP),
    expenseCategories: expenseCategories.map((e) => ({ category: e.category, amount: round(Number(e.amount)), count: Number(e.count) })),
    orders: orders.items.map((o) => ({ ...o, amount: round(Number(o.amount)), items: Number(o.items) })),
    ordersTotal: orders.total,
  };
  // Günlük dökümde 45 günü aşan aralıklarda gün gün satırlar ayrıca hesaplanır
  if (kind !== 'daily' && dailyRows.length === 0) {
    const rows = await db.query<{ date: string; orders: number; units: number; revenue: number }>(
      `SELECT o.order_date AS date, COUNT(DISTINCT o.id) AS orders, SUM(oi.quantity) AS units,
              SUM(oi.quantity * oi.unit_price * ${fxFactor('o.order_date')}) AS revenue
       FROM orders o JOIN order_items oi ON oi.order_id = o.id
       WHERE o.status = 'delivered' AND o.order_date >= ? AND o.order_date <= ? GROUP BY o.order_date ORDER BY o.order_date`,
      [period.from, period.to],
    );
    base.days = rows.map((r) => ({ date: r.date, orders: Number(r.orders), units: Number(r.units), revenue: round(Number(r.revenue)) }));
  }
  return { ...base, highlights: highlights(base) };
}

// ── Bildirimler: aylık ekstre ve gün sonu raporu ──

export interface ReportSettings {
  monthly: boolean;
  daily: boolean;
  /** Gün sonu raporunun bildirileceği saat (0-23) */
  dailyHour: number;
}

const SETTING_KEYS = { monthly: 'notify_monthly', daily: 'notify_daily', dailyHour: 'notify_daily_hour' } as const;
export const DEFAULT_REPORT_SETTINGS: ReportSettings = { monthly: true, daily: true, dailyHour: 18 };

export async function getReportSettings(db: DbClient): Promise<ReportSettings> {
  const [monthly, daily, hour] = await Promise.all([
    getSetting(db, SETTING_KEYS.monthly),
    getSetting(db, SETTING_KEYS.daily),
    getSetting(db, SETTING_KEYS.dailyHour),
  ]);
  const dailyHour = Number(hour);
  return {
    monthly: monthly === null ? DEFAULT_REPORT_SETTINGS.monthly : monthly === 'true',
    daily: daily === null ? DEFAULT_REPORT_SETTINGS.daily : daily === 'true',
    dailyHour: hour !== null && Number.isInteger(dailyHour) && dailyHour >= 0 && dailyHour <= 23 ? dailyHour : DEFAULT_REPORT_SETTINGS.dailyHour,
  };
}

export async function saveReportSettings(db: DbClient, settings: ReportSettings): Promise<void> {
  await setSetting(db, SETTING_KEYS.monthly, String(settings.monthly));
  await setSetting(db, SETTING_KEYS.daily, String(settings.daily));
  await setSetting(db, SETTING_KEYS.dailyHour, String(settings.dailyHour));
}

export interface ReportNotice {
  id: string;
  kind: 'monthly' | 'daily' | 'receivables';
  title: string;
  body: string;
  /** Ekstre sayfasında açılacak dönem */
  query: { kind: 'monthly'; month: string } | { kind: 'daily'; date: string } | { kind: 'receivables'; tab: 'customers' | 'suppliers' };
  /** Bildirimin oluştuğu an (aylık: ayın 1'i 00:00, gün sonu: o gün ayarlanan saat) */
  availableAt: string;
}

const DAILY_LOOKBACK = 7;

/**
 * Zildeki rapor bildirimleri: geçen ayın ekstresi (ayın 1'inden itibaren) ve son 7 günün gün sonu raporları
 * (yalnızca işlem olan günler, ayarlanan saatten sonra). Tutarlar gösterim para biriminde.
 */
export async function getReportNotices(db: DbClient, now = new Date()): Promise<ReportNotice[]> {
  const settings = await getReportSettings(db);
  const notices: ReportNotice[] = [];

  if (settings.daily) {
    const today = localDate(now);
    const since = addDays(today, -(DAILY_LOOKBACK - 1));
    const rows = await db.query<{ date: string; orders: number; revenue: number }>(
      `SELECT o.order_date AS date, COUNT(DISTINCT o.id) AS orders, SUM(oi.quantity * oi.unit_price * ${fxFactor('o.order_date')}) AS revenue
       FROM orders o JOIN order_items oi ON oi.order_id = o.id
       WHERE o.status = 'delivered' AND o.order_date >= ? AND o.order_date <= ? GROUP BY o.order_date ORDER BY o.order_date DESC`,
      [since, today],
    );
    for (const row of rows) {
      const [y, m, d] = row.date.split('-').map(Number) as [number, number, number];
      const at = new Date(y, m - 1, d, settings.dailyHour, 0, 0);
      if (at > now) continue;
      notices.push({
        id: `daily-${row.date}`,
        kind: 'daily',
        title: `Gün sonu raporu · ${dayLabel(row.date)}`,
        body: `${formatNumber(Number(row.orders))} sipariş · ${formatCurrency(Number(row.revenue))} ciro`,
        query: { kind: 'daily', date: row.date },
        availableAt: at.toISOString(),
      });
    }
  }

  if (settings.monthly) {
    const previous = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const month = `${previous.getFullYear()}-${pad(previous.getMonth() + 1)}`;
    const period = monthPeriod(month);
    const totals = await getReportTotals(db, { status: 'delivered' }, period);
    const expenses = await db.queryOne<{ n: number }>('SELECT COUNT(*) AS n FROM expenses WHERE expense_date >= ? AND expense_date <= ?', [period.from, period.to]);
    if (totals.orders > 0 || (expenses?.n ?? 0) > 0) {
      notices.push({
        id: `monthly-${month}`,
        kind: 'monthly',
        title: `${monthLabel(month)} ekstreniz hazır`,
        body: `${formatNumber(totals.orders)} sipariş · ${formatCurrency(totals.revenue)} ciro. PDF veya Excel olarak indirebilirsiniz.`,
        query: { kind: 'monthly', month },
        availableAt: new Date(now.getFullYear(), now.getMonth(), 1).toISOString(),
      });
    }
  }
  return notices.sort((a, b) => b.availableAt.localeCompare(a.availableAt));
}

/** Tarih aralığı denetimi (rapor yolu ile aynı sınır) */
export function assertPeriod(period: Period): void {
  if (period.from > period.to) throw new RangeError('Başlangıç tarihi bitiş tarihinden sonra olamaz.');
  if (daysBetween(period.from, period.to) > 11_000) throw new RangeError('Tarih aralığı çok uzun.');
}
