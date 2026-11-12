import {
  CHURN_MIN_ORDERS,
  CHURN_MULTIPLIER,
  CHURN_WATCH_MULTIPLIER,
  DAYS_PER_MONTH,
  SEGMENT_A_REVENUE_SHARE,
  SEGMENT_B_REVENUE_SHARE,
} from '../config/thresholds.js';
import type { DbClient } from '../db/types.js';
import { getCustomerOrderDates, getCustomers, type CustomerType } from '../repositories/customerRepository.js';
import { getCustomerSales, getCustomerTopProducts } from '../repositories/salesRepository.js';
import { daysBetween } from '../utils/dates.js';
import { formatCurrency, formatDate, formatNumber } from '../utils/format.js';
import { median, round, sum } from '../utils/stats.js';
import type { AnalysisContext } from './context.js';
import { compareInsights, type InsightBase, type RegionRef } from './types.js';

export type CustomerStatus = 'active' | 'watch' | 'churn_risk' | 'insufficient_data';
export type Segment = 'A' | 'B' | 'C';

export interface CustomerRef {
  id: number;
  name: string;
  type: CustomerType;
  region: RegionRef;
  salesRepName: string | null;
}

export interface CustomerActivity {
  customer: CustomerRef;
  segment: Segment;
  orderCount: number;
  firstOrderDate: string | null;
  lastOrderDate: string | null;
  medianIntervalDays: number | null;
  daysSinceLastOrder: number | null;
  /** Sessizlik süresi / tipik sipariş aralığı */
  silenceRatio: number | null;
  status: CustomerStatus;
  totalRevenue: number;
  avgMonthlyRevenue: number;
}

export interface ChurnItem extends InsightBase {
  kind: 'churn';
  customer: CustomerRef;
  metrics: {
    orderCount: number;
    medianIntervalDays: number;
    daysSinceLastOrder: number;
    silenceRatio: number;
    lastOrderDate: string;
    avgMonthlyRevenue: number;
    topProducts: string[];
  };
}

const ALL_TIME_FROM = '0000-01-01';

/**
 * Her müşterinin sipariş ritmini çıkarır. Tipik aralık = ardışık sipariş günleri
 * arasındaki farkların MEDYANI (tek seferlik gecikmelere karşı ortalamadan daha dayanıklı).
 */
export async function getCustomerActivity(db: DbClient, ctx: AnalysisContext): Promise<CustomerActivity[]> {
  const [customers, orderDates, revenueRows] = await Promise.all([
    getCustomers(db),
    getCustomerOrderDates(db, ctx.asOf),
    getCustomerSales(db, { from: ALL_TIME_FROM, to: ctx.asOf }),
  ]);

  const datesByCustomer = new Map<number, string[]>();
  for (const row of orderDates) {
    const list = datesByCustomer.get(row.customerId) ?? [];
    list.push(row.orderDate);
    datesByCustomer.set(row.customerId, list);
  }
  const revenueByCustomer = new Map(revenueRows.map((r) => [r.customerId, r.revenue]));
  const segments = assignSegments(customers.map((c) => ({ id: c.id, revenue: revenueByCustomer.get(c.id) ?? 0 })));

  return customers.map((c) => {
    const dates = datesByCustomer.get(c.id) ?? [];
    const intervals = dates.slice(1).map((date, i) => daysBetween(dates[i]!, date));
    const medianInterval = median(intervals);
    const first = dates[0] ?? null;
    const last = dates.at(-1) ?? null;
    const daysSince = last ? daysBetween(last, ctx.asOf) : null;
    const ratio = medianInterval && daysSince !== null ? daysSince / medianInterval : null;
    const totalRevenue = revenueByCustomer.get(c.id) ?? 0;

    // Aktif olduğu süre: ilk siparişten son siparişin kapsadığı döneme kadar
    const activeDays = first && last ? daysBetween(first, last) + (medianInterval ?? 0) : 0;
    const avgMonthlyRevenue = totalRevenue / Math.max(1, activeDays / DAYS_PER_MONTH);

    let status: CustomerStatus = 'insufficient_data';
    if (dates.length >= CHURN_MIN_ORDERS && ratio !== null) {
      status =
        ratio >= CHURN_MULTIPLIER ? 'churn_risk' : ratio >= CHURN_WATCH_MULTIPLIER ? 'watch' : 'active';
    }

    return {
      customer: {
        id: c.id,
        name: c.name,
        type: c.customerType,
        region: { id: c.regionId, name: c.regionName },
        salesRepName: c.salesRepName,
      },
      segment: segments.get(c.id) ?? 'C',
      orderCount: dates.length,
      firstOrderDate: first,
      lastOrderDate: last,
      medianIntervalDays: medianInterval,
      daysSinceLastOrder: daysSince,
      silenceRatio: ratio === null ? null : round(ratio, 2),
      status,
      totalRevenue: round(totalRevenue),
      avgMonthlyRevenue: round(avgMonthlyRevenue),
    };
  });
}

/** ABC (Pareto) segmentasyonu: cironun ilk %80'i A, sonraki %15'i B, kalanı C. */
export function assignSegments(customers: { id: number; revenue: number }[]): Map<number, Segment> {
  const total = sum(customers.map((c) => c.revenue));
  const sorted = [...customers].sort((a, b) => b.revenue - a.revenue);
  const segments = new Map<number, Segment>();
  let cumulativeBefore = 0;
  for (const c of sorted) {
    const shareBefore = total > 0 ? cumulativeBefore / total : 1;
    segments.set(c.id, shareBefore < SEGMENT_A_REVENUE_SHARE ? 'A' : shareBefore < SEGMENT_B_REVENUE_SHARE ? 'B' : 'C');
    cumulativeBefore += c.revenue;
  }
  return segments;
}

/**
 * Müşteri kaybı tespiti: kendi medyan sipariş aralığının CHURN_MULTIPLIER
 * katından uzun süredir sipariş vermeyen müşteriler.
 */
export async function detectChurnRisks(db: DbClient, ctx: AnalysisContext): Promise<ChurnItem[]> {
  const activity = await getCustomerActivity(db, ctx);
  const atRisk = activity.filter((a) => a.status === 'churn_risk');

  const items = await Promise.all(
    atRisk.map(async (a): Promise<ChurnItem> => {
      const topProducts = await getCustomerTopProducts(db, a.customer.id, 3);
      const medianDays = a.medianIntervalDays!;
      const daysSince = a.daysSinceLastOrder!;
      const ratio = a.silenceRatio!;
      const { name, region, type, salesRepName } = a.customer;

      return {
        id: `churn-customer-${a.customer.id}`,
        kind: 'churn',
        severity: ratio >= CHURN_MULTIPLIER * 2 || a.segment === 'A' ? 'high' : 'medium',
        customer: a.customer,
        title: `${name}: kayıp riski`,
        message:
          `${name} (${region.name}, ${type}) normalde ~${formatNumber(medianDays)} günde bir sipariş veriyor, ` +
          `ancak ${daysSince} gündür sipariş vermedi (tipik aralığın ${formatNumber(ratio, 1)} katı). ` +
          `Son sipariş: ${formatDate(a.lastOrderDate!)}.`,
        recommendation:
          `${salesRepName ?? 'Satış ekibi'} bu hafta ${name} ile iletişime geçmeli. ` +
          (topProducts.length ? `Ana ürünleri (${topProducts.join(', ')}) için kişiye özel teklif hazırlanabilir. ` : '') +
          `Aylık ~${formatCurrency(a.avgMonthlyRevenue)} ciro risk altında.`,
        impactAmount: a.avgMonthlyRevenue,
        impactLabel: 'Risk altındaki aylık ciro',
        metrics: {
          orderCount: a.orderCount,
          medianIntervalDays: medianDays,
          daysSinceLastOrder: daysSince,
          silenceRatio: ratio,
          lastOrderDate: a.lastOrderDate!,
          avgMonthlyRevenue: a.avgMonthlyRevenue,
          topProducts,
        },
      };
    }),
  );

  return items.sort(compareInsights);
}

const SEGMENT_LABELS: Record<Segment, string> = {
  A: 'A — Kilit müşteriler',
  B: 'B — Gelişen müşteriler',
  C: 'C — Düşük hacimli müşteriler',
};

export async function getCustomerAnalysis(db: DbClient, ctx: AnalysisContext) {
  const [activity, churnRisks, currentSales] = await Promise.all([
    getCustomerActivity(db, ctx),
    detectChurnRisks(db, ctx),
    getCustomerSales(db, ctx.current),
  ]);
  const totalRevenue = sum(activity.map((a) => a.totalRevenue));

  const segments = (['A', 'B', 'C'] as const).map((segment) => {
    const members = activity.filter((a) => a.segment === segment);
    const revenue = sum(members.map((m) => m.totalRevenue));
    return {
      segment,
      label: SEGMENT_LABELS[segment],
      customerCount: members.length,
      revenue: round(revenue),
      revenueShare: totalRevenue > 0 ? round(revenue / totalRevenue, 4) : 0,
      churnRiskCount: members.filter((m) => m.status === 'churn_risk').length,
    };
  });

  const byType = (['Bayi', 'Mağaza'] as const).map((type) => {
    const members = activity.filter((a) => a.customer.type === type);
    return { type, customerCount: members.length, revenue: round(sum(members.map((m) => m.totalRevenue))) };
  });

  const statusCounts = {
    active: activity.filter((a) => a.status === 'active').length,
    watch: activity.filter((a) => a.status === 'watch').length,
    churnRisk: activity.filter((a) => a.status === 'churn_risk').length,
    insufficientData: activity.filter((a) => a.status === 'insufficient_data').length,
  };

  return {
    asOf: ctx.asOf,
    summary: {
      totalCustomers: activity.length,
      /** Son 30 günde sipariş veren müşteri sayısı */
      activeCustomers: currentSales.length,
      ...statusCounts,
      monthlyRevenueAtRisk: round(sum(churnRisks.map((c) => c.impactAmount))),
    },
    thresholds: {
      churnSilenceMultiplier: CHURN_MULTIPLIER,
      watchMultiplier: CHURN_WATCH_MULTIPLIER,
      minOrders: CHURN_MIN_ORDERS,
    },
    segments,
    byType,
    churnRisks,
    customers: [...activity].sort(
      (a, b) => (b.silenceRatio ?? 0) - (a.silenceRatio ?? 0) || b.totalRevenue - a.totalRevenue,
    ),
  };
}
