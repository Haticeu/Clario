import type { DbClient } from '../db/types.js';
import {
  getReportBreakdown,
  getReportDaily,
  getReportExpenses,
  getReportOrders,
  getReportTotals,
  REPORT_DIMENSIONS,
  type Period,
  type ReportBreakdownRow,
  type ReportDimension,
  type ReportFilter,
  type ReportTotalsRow,
} from '../repositories/reportRepository.js';
import { addDays, daysBetween, parseIsoDate, toIsoDate } from '../utils/dates.js';
import { pctChange, round } from '../utils/stats.js';

export type Granularity = 'day' | 'week' | 'month';

const BREAKDOWN_LIMIT = 50;
export const ORDERS_PAGE_SIZE = 50;

export interface ReportTotals {
  revenue: number;
  units: number;
  orders: number;
  customers: number;
  avgOrderValue: number;
  /** Maliyeti bilinen ürünler üzerinden; hiç maliyet yoksa null */
  grossProfit: number | null;
  grossMarginPct: number | null;
  costCoverage: number;
}

function totals(row: ReportTotalsRow): ReportTotals {
  const grossProfit = row.costedRevenue > 0 ? row.costedRevenue - row.cost : null;
  return {
    revenue: round(row.revenue),
    units: row.units,
    orders: row.orders,
    customers: row.customers,
    avgOrderValue: row.orders > 0 ? round(row.revenue / row.orders) : 0,
    grossProfit: grossProfit === null ? null : round(grossProfit),
    grossMarginPct: grossProfit === null ? null : round(grossProfit / row.costedRevenue, 4),
    costCoverage: row.revenue > 0 ? round(row.costedRevenue / row.revenue, 4) : 0,
  };
}

/** Seçilen dönemle aynı uzunlukta, hemen önceki dönem (karşılaştırma için). */
export function previousPeriod(period: Period): Period {
  const days = daysBetween(period.from, period.to) + 1;
  const to = addDays(period.from, -1);
  return { from: addDays(to, -(days - 1)), to };
}

/** Grafik aralığı: kısa dönemde günlük, bir yıla kadar haftalık, daha uzunsa aylık. */
export function granularityFor(days: number): Granularity {
  return days <= 45 ? 'day' : days <= 200 ? 'week' : 'month';
}

/** Tarihin ait olduğu dilimin başlangıcı: gün, haftanın pazartesisi veya ayın ilk günü. */
export function bucketStart(date: string, granularity: Granularity): string {
  if (granularity === 'day') return date;
  if (granularity === 'month') return `${date.slice(0, 7)}-01`;
  const weekday = (parseIsoDate(date).getUTCDay() + 6) % 7; // pazartesi = 0
  return addDays(date, -weekday);
}

function nextBucket(start: string, granularity: Granularity): string {
  if (granularity === 'day') return addDays(start, 1);
  if (granularity === 'week') return addDays(start, 7);
  const d = parseIsoDate(start);
  return toIsoDate(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1)));
}

export interface SeriesPoint {
  /** Dilimin başlangıç tarihi */
  start: string;
  revenue: number;
  orders: number;
  units: number;
}

export interface BreakdownRow {
  key: string | number | null;
  name: string | null;
  revenue: number;
  units: number;
  orders: number;
  /** Filtrelenmiş toplam ciro içindeki pay */
  share: number;
  previousRevenue: number;
  changePct: number | null;
  grossMarginPct: number | null;
}

function breakdown(current: ReportBreakdownRow[], previous: ReportBreakdownRow[], totalRevenue: number): BreakdownRow[] {
  const before = new Map(previous.map((row) => [String(row.key), row.revenue]));
  return current.map((row) => {
    const previousRevenue = round(before.get(String(row.key)) ?? 0);
    const change = pctChange(row.revenue, previousRevenue);
    return {
      key: row.key,
      name: row.name,
      revenue: round(row.revenue),
      units: row.units,
      orders: row.orders,
      share: totalRevenue > 0 ? round(row.revenue / totalRevenue, 4) : 0,
      previousRevenue,
      changePct: change === null ? null : round(change, 4),
      grossMarginPct: row.costedRevenue > 0 ? round((row.costedRevenue - row.cost) / row.costedRevenue, 4) : null,
    };
  });
}

/**
 * Filtrelenebilir rapor: seçilen dönem ve filtrelere uyan satışların özeti, önceki eşit uzunluktaki dönemle
 * karşılaştırma, zaman serisi, tüm boyutlarda kırılım ve sipariş listesi.
 */
export async function getReport(db: DbClient, filter: ReportFilter, period: Period, ordersOffset = 0) {
  const previous = previousPeriod(period);
  const days = daysBetween(period.from, period.to) + 1;
  const granularity = granularityFor(days);
  const dimensions = Object.keys(REPORT_DIMENSIONS) as ReportDimension[];

  const [currentTotals, previousTotals, daily, expenses, orders, ...breakdownRows] = await Promise.all([
    getReportTotals(db, filter, period),
    getReportTotals(db, filter, previous),
    getReportDaily(db, filter, period),
    getReportExpenses(db, filter, period),
    getReportOrders(db, filter, period, ORDERS_PAGE_SIZE, ordersOffset),
    ...dimensions.flatMap((dimension) => [
      getReportBreakdown(db, filter, period, dimension, BREAKDOWN_LIMIT),
      getReportBreakdown(db, filter, previous, dimension, BREAKDOWN_LIMIT * 4),
    ]),
  ]);

  // Boş dilimler de sıfırla gösterilir (grafikte boşluk "satış yok" demektir)
  const buckets = new Map<string, SeriesPoint>();
  for (let start = bucketStart(period.from, granularity); start <= period.to; start = nextBucket(start, granularity)) {
    buckets.set(start, { start, revenue: 0, orders: 0, units: 0 });
  }
  for (const row of daily) {
    const point = buckets.get(bucketStart(row.date, granularity));
    if (!point) continue;
    point.revenue += row.revenue;
    point.orders += row.orders;
    point.units += row.units;
  }

  const current = totals(currentTotals);
  const before = totals(previousTotals);
  const change = (a: number, b: number) => {
    const value = pctChange(a, b);
    return value === null ? null : round(value, 4);
  };

  return {
    period: { ...period, days },
    previousPeriod: previous,
    totals: current,
    previousTotals: before,
    changes: {
      revenue: change(current.revenue, before.revenue),
      orders: change(current.orders, before.orders),
      customers: change(current.customers, before.customers),
      units: change(current.units, before.units),
      avgOrderValue: change(current.avgOrderValue, before.avgOrderValue),
      grossProfit: current.grossProfit === null || before.grossProfit === null ? null : change(current.grossProfit, before.grossProfit),
    },
    /** Dönem giderleri (ürün/müşteri filtresi varken hesaplanmaz) */
    expenses: expenses === null ? null : round(expenses),
    /** Net katkı = ciro − maliyeti bilinen ürünlerin maliyeti − giderler (Departman & Proje sayfasıyla aynı tanım) */
    netContribution: expenses === null ? null : round(currentTotals.revenue - currentTotals.cost - expenses),
    series: {
      granularity,
      points: [...buckets.values()].map((p) => ({ ...p, revenue: round(p.revenue) })),
    },
    breakdowns: Object.fromEntries(
      dimensions.map((dimension, i) => [dimension, breakdown(breakdownRows[i * 2]!, breakdownRows[i * 2 + 1]!, current.revenue)]),
    ) as Record<ReportDimension, BreakdownRow[]>,
    orders: { ...orders, offset: ordersOffset, pageSize: ORDERS_PAGE_SIZE },
  };
}

export type Report = Awaited<ReturnType<typeof getReport>>;
