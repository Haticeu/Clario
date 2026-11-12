import { COMPARISON_WINDOW_DAYS, REVENUE_FLAT_THRESHOLD, TREND_WEEKS } from '../config/thresholds.js';
import type { DbClient } from '../db/types.js';
import { getProducts } from '../repositories/catalogRepository.js';
import {
  getCustomerSales,
  getDailySales,
  getProductSales,
  getRegionSales,
  getSalesTotals,
} from '../repositories/salesRepository.js';
import { addDays, daysBetween } from '../utils/dates.js';
import { formatCurrency, formatPercent, formatSignedCurrency, formatSignedPercent } from '../utils/format.js';
import { pctChange, round } from '../utils/stats.js';
import type { AnalysisContext } from './context.js';
import { getMarginAnalysis } from './margins.js';
import type { ProductRef, RegionRef } from './types.js';

export interface ProductComparison {
  product: ProductRef;
  currentUnits: number;
  previousUnits: number;
  unitsChangePct: number | null;
  currentRevenue: number;
  previousRevenue: number;
  revenueDelta: number;
  revenueChangePct: number | null;
}

export interface RegionComparison {
  region: RegionRef;
  currentRevenue: number;
  previousRevenue: number;
  revenueDelta: number;
  revenueChangePct: number | null;
  currentOrders: number;
  previousOrders: number;
}

export interface RevenueExplanationInput {
  currentRevenue: number;
  previousRevenue: number;
  products: ProductComparison[];
  regions: RegionComparison[];
  lostCustomers: { count: number; previousRevenue: number };
  volumeEffect: number;
  priceEffect: number;
}

export interface RevenueExplanation {
  direction: 'up' | 'down' | 'flat';
  revenueDelta: number;
  revenueChangePct: number | null;
  summary: string;
  bullets: string[];
  volumeEffect: number;
  priceEffect: number;
  lostCustomers: { count: number; previousRevenue: number };
}

/**
 * "Ciro neden değişti?" sorusunu veriden yanıtlar: toplam değişimi ürün, bölge,
 * kaybedilen müşteri ve fiyat/hacim etkilerine ayrıştırıp okunabilir cümlelere çevirir.
 */
export function explainRevenueChange(input: RevenueExplanationInput): RevenueExplanation {
  const delta = input.currentRevenue - input.previousRevenue;
  const change = pctChange(input.currentRevenue, input.previousRevenue);
  const direction = change !== null && Math.abs(change) < REVENUE_FLAT_THRESHOLD ? 'flat' : delta < 0 ? 'down' : 'up';
  const sign = direction === 'down' ? -1 : 1;
  const days = COMPARISON_WINDOW_DAYS;

  const range = `${formatCurrency(input.previousRevenue)} → ${formatCurrency(input.currentRevenue)}`;
  const summary =
    direction === 'flat'
      ? `Ciro son ${days} günde yatay seyretti (${formatSignedPercent(change ?? 0, 1)}; ${range}).`
      : `Ciro son ${days} günde ${formatPercent(change ?? 0)} ${direction === 'down' ? 'düştü' : 'arttı'} ` +
        `(${range}; ${formatSignedCurrency(delta)}).`;

  const bullets: string[] = [];
  const word = direction === 'down' ? 'Düşüşün' : 'Artışın';

  // Değişimle aynı yöndeki en büyük ürün katkıları
  const drivers = input.products
    .filter((p) => Math.sign(p.revenueDelta) === sign && p.revenueDelta !== 0)
    .sort((a, b) => Math.abs(b.revenueDelta) - Math.abs(a.revenueDelta));
  const [first, second] = drivers;
  if (first && direction !== 'flat') {
    const share = delta !== 0 ? first.revenueDelta / delta : 0;
    bullets.push(
      `${word} en büyük kaynağı ${first.product.name}: ${formatSignedCurrency(first.revenueDelta)}` +
        (share > 0 && share <= 5 ? ` (toplam değişimdeki payı: ${formatPercent(share)}).` : '.'),
    );
    if (second) bullets.push(`Ardından ${second.product.name}: ${formatSignedCurrency(second.revenueDelta)}.`);
  } else if (first) {
    bullets.push(`En büyük ürün hareketi ${first.product.name}: ${formatSignedCurrency(first.revenueDelta)}.`);
  }

  // Bölge bazında en büyük katkı
  const region = [...input.regions]
    .filter((r) => r.revenueDelta !== 0 && (direction === 'flat' || Math.sign(r.revenueDelta) === sign))
    .sort((a, b) => Math.abs(b.revenueDelta) - Math.abs(a.revenueDelta))[0];
  if (region) {
    bullets.push(
      `Bölge bazında en büyük ${region.revenueDelta < 0 ? 'düşüş' : 'artış'} ${region.region.name} bölgesinde: ` +
        `${formatSignedCurrency(region.revenueDelta)}` +
        (region.revenueChangePct === null ? '.' : ` (${formatSignedPercent(region.revenueChangePct)}).`),
    );
  }

  if (input.lostCustomers.count > 0) {
    bullets.push(
      `Önceki dönemde sipariş verip son ${days} günde hiç sipariş vermeyen ${input.lostCustomers.count} müşteri ` +
        `var; önceki dönemdeki cirosu ${formatCurrency(input.lostCustomers.previousRevenue)}.`,
    );
  }

  const volumeDominant = Math.abs(input.volumeEffect) >= Math.abs(input.priceEffect);
  bullets.push(
    `Fiyat/hacim ayrıştırması: hacim etkisi ${formatSignedCurrency(input.volumeEffect)}, ` +
      `fiyat etkisi ${formatSignedCurrency(input.priceEffect)} → değişim ağırlıklı olarak ` +
      `${volumeDominant ? 'satış adedinden' : 'fiyat/iskonto değişiminden'} kaynaklanıyor.`,
  );

  // Ters yönde dengeleyen en büyük kalem
  const offset = input.products
    .filter((p) => direction !== 'flat' && Math.sign(p.revenueDelta) === -sign)
    .sort((a, b) => Math.abs(b.revenueDelta) - Math.abs(a.revenueDelta))[0];
  if (offset) {
    bullets.push(
      `${direction === 'down' ? 'Düşüşü' : 'Artışı'} kısmen dengeleyen: ${offset.product.name} ` +
        `(${formatSignedCurrency(offset.revenueDelta)}).`,
    );
  }

  return {
    direction,
    revenueDelta: round(delta),
    revenueChangePct: change === null ? null : round(change, 4),
    summary,
    bullets,
    volumeEffect: round(input.volumeEffect),
    priceEffect: round(input.priceEffect),
    lostCustomers: { count: input.lostCustomers.count, previousRevenue: round(input.lostCustomers.previousRevenue) },
  };
}

/** Fiyat/hacim ayrıştırması: hacim = Δadet × eski fiyat, fiyat = Δfiyat × yeni adet. */
function priceVolumeEffects(products: ProductComparison[]) {
  let volumeEffect = 0;
  let priceEffect = 0;
  for (const p of products) {
    if (p.previousUnits > 0 && p.currentUnits > 0) {
      const oldPrice = p.previousRevenue / p.previousUnits;
      const newPrice = p.currentRevenue / p.currentUnits;
      volumeEffect += (p.currentUnits - p.previousUnits) * oldPrice;
      priceEffect += (newPrice - oldPrice) * p.currentUnits;
    } else {
      volumeEffect += p.revenueDelta;
    }
  }
  return { volumeEffect, priceEffect };
}

/** Haftalık ciro serisi; haftalar referans tarihinde biter. */
async function getWeeklyTrend(db: DbClient, ctx: AnalysisContext) {
  const days = TREND_WEEKS * 7;
  const daily = await getDailySales(db, { from: addDays(ctx.asOf, -days), to: ctx.asOf });
  const weeks = Array.from({ length: TREND_WEEKS }, (_, i) => {
    const weekEnd = addDays(ctx.asOf, -7 * (TREND_WEEKS - 1 - i));
    return { weekStart: addDays(weekEnd, -6), weekEnd, revenue: 0, units: 0 };
  });
  for (const day of daily) {
    const index = TREND_WEEKS - 1 - Math.floor(daysBetween(day.date, ctx.asOf) / 7);
    const week = weeks[index];
    if (week) {
      week.revenue += day.revenue;
      week.units += day.units;
    }
  }
  return weeks.map((w) => ({ ...w, revenue: round(w.revenue) }));
}

export async function getSalesAnalytics(db: DbClient, ctx: AnalysisContext) {
  const [products, curProducts, prevProducts, curRegions, prevRegions, curTotals, prevTotals, curCustomers, prevCustomers, weeklyTrend, margins] =
    await Promise.all([
      getProducts(db),
      getProductSales(db, ctx.current),
      getProductSales(db, ctx.previous),
      getRegionSales(db, ctx.current),
      getRegionSales(db, ctx.previous),
      getSalesTotals(db, ctx.current),
      getSalesTotals(db, ctx.previous),
      getCustomerSales(db, ctx.current),
      getCustomerSales(db, ctx.previous),
      getWeeklyTrend(db, ctx),
      getMarginAnalysis(db, ctx),
    ]);

  const curById = new Map(curProducts.map((r) => [r.productId, r]));
  const prevById = new Map(prevProducts.map((r) => [r.productId, r]));
  const productComparisons: ProductComparison[] = products.map((p) => {
    const cur = curById.get(p.id) ?? { units: 0, revenue: 0 };
    const prev = prevById.get(p.id) ?? { units: 0, revenue: 0 };
    const unitsChange = pctChange(cur.units, prev.units);
    const revenueChange = pctChange(cur.revenue, prev.revenue);
    return {
      product: { id: p.id, sku: p.sku, name: p.name, category: p.category },
      currentUnits: cur.units,
      previousUnits: prev.units,
      unitsChangePct: unitsChange === null ? null : round(unitsChange, 4),
      currentRevenue: round(cur.revenue),
      previousRevenue: round(prev.revenue),
      revenueDelta: round(cur.revenue - prev.revenue),
      revenueChangePct: revenueChange === null ? null : round(revenueChange, 4),
    };
  });

  const prevRegionById = new Map(prevRegions.map((r) => [r.regionId, r]));
  const regionComparisons: RegionComparison[] = curRegions.map((cur) => {
    const prev = prevRegionById.get(cur.regionId);
    const change = pctChange(cur.revenue, prev?.revenue ?? 0);
    return {
      region: { id: cur.regionId, name: cur.regionName },
      currentRevenue: round(cur.revenue),
      previousRevenue: round(prev?.revenue ?? 0),
      revenueDelta: round(cur.revenue - (prev?.revenue ?? 0)),
      revenueChangePct: change === null ? null : round(change, 4),
      currentOrders: cur.orders,
      previousOrders: prev?.orders ?? 0,
    };
  });

  const activeNow = new Set(curCustomers.map((c) => c.customerId));
  const lost = prevCustomers.filter((c) => !activeNow.has(c.customerId));
  const { volumeEffect, priceEffect } = priceVolumeEffects(productComparisons);

  const explanation = explainRevenueChange({
    currentRevenue: curTotals.revenue,
    previousRevenue: prevTotals.revenue,
    products: productComparisons,
    regions: regionComparisons,
    lostCustomers: { count: lost.length, previousRevenue: lost.reduce((t, c) => t + c.revenue, 0) },
    volumeEffect,
    priceEffect,
  });

  // Brüt kâr yalnızca maliyeti bilinen ürünlerden hesaplanır; hiçbirinin maliyeti yoksa bilinmez (null)
  const totals = (t: typeof curTotals) => ({
    revenue: round(t.revenue),
    grossProfit: t.costedRevenue > 0 ? round(t.costedRevenue - t.cost) : null,
    /** Brüt kâr hesabına giren cironun toplam ciroya oranı (1 = tüm ürünlerin maliyeti biliniyor) */
    costCoverage: t.revenue > 0 ? round(t.costedRevenue / t.revenue, 4) : 0,
    grossMarginPct: t.costedRevenue > 0 ? round((t.costedRevenue - t.cost) / t.costedRevenue, 4) : null,
    units: t.units,
    orders: t.orders,
    customers: t.customers,
    avgOrderValue: t.orders > 0 ? round(t.revenue / t.orders) : 0,
  });

  return {
    asOf: ctx.asOf,
    windows: { current: ctx.current, previous: ctx.previous },
    totals: { current: totals(curTotals), previous: totals(prevTotals) },
    explanation,
    products: productComparisons.sort((a, b) => a.revenueDelta - b.revenueDelta),
    regions: regionComparisons.sort((a, b) => a.revenueDelta - b.revenueDelta),
    weeklyTrend,
    margins,
  };
}
