import {
  COMPARISON_WINDOW_DAYS,
  DAYS_PER_MONTH,
  HIGH_STOCK_MONTHS,
  LOW_STOCK_MONTHS,
  RISK_DECLINE_THRESHOLD,
  TARGET_STOCK_MONTHS,
} from '../config/thresholds.js';
import type { DbClient } from '../db/types.js';
import { getInventory, getProducts, getRegions } from '../repositories/catalogRepository.js';
import { getProductRegionSales, getProductSales } from '../repositories/salesRepository.js';
import { formatCurrency, formatNumber, formatPercent, formatSignedPercent } from '../utils/format.js';
import { groupSum, pctChange, round, roundUpTo } from '../utils/stats.js';
import type { AnalysisContext } from './context.js';
import { classifyCoverage, monthlyVelocity, monthsOfCover } from './stock.js';
import { compareInsights, type InsightBase, type ProductRef, type Severity } from './types.js';

export type RiskSignal = 'sales_decline' | 'overstock' | 'stockout';

export interface RiskItem extends InsightBase {
  kind: 'risk';
  signals: RiskSignal[];
  product: ProductRef;
  metrics: {
    currentUnits: number;
    previousUnits: number;
    salesChangePct: number | null;
    currentRevenue: number;
    previousRevenue: number;
    /** Stok hiç girilmemişse null */
    stockUnits: number | null;
    monthlyVelocity: number;
    monthsOfStock: number | null;
    excessUnits: number;
    shortfallUnits: number;
    /** Düşüşün en çok yaşandığı bölge (yalnızca satış düşüşünde). */
    weakestRegion: { name: string; unitsDelta: number } | null;
  };
}

const TITLES: Record<string, string> = {
  'sales_decline+overstock': 'Satış düşüşü ve fazla stok',
  'sales_decline+stockout': 'Satış düşüşü ve tükenme riski',
  sales_decline: 'Satış düşüşü',
  overstock: 'Fazla stok',
  stockout: 'Stok tükenme riski',
};

/**
 * Ürün bazında risk tespiti. Bir ürün aşağıdakilerden en az birini sağlarsa risklidir:
 *  - Son 30 gün satışı önceki 30 güne göre >= RISK_DECLINE_THRESHOLD düşmüş
 *  - Stok, mevcut satış hızına göre > HIGH_STOCK_MONTHS ay yetiyor (fazla stok)
 *  - Stok, mevcut satış hızına göre < LOW_STOCK_MONTHS ay yetiyor (tükenme riski)
 * Aynı ürüne ait sinyaller tek bir risk kartında birleştirilir.
 */
export async function detectRisks(db: DbClient, ctx: AnalysisContext): Promise<RiskItem[]> {
  const [products, regions, inventory, current, previous, regionCurrent, regionPrevious] = await Promise.all([
    getProducts(db),
    getRegions(db),
    getInventory(db),
    getProductSales(db, ctx.current),
    getProductSales(db, ctx.previous),
    getProductRegionSales(db, ctx.current),
    getProductRegionSales(db, ctx.previous),
  ]);

  const stockByProduct = groupSum(inventory, (r) => r.productId, (r) => r.quantity);
  const currentById = new Map(current.map((r) => [r.productId, r]));
  const previousById = new Map(previous.map((r) => [r.productId, r]));
  const regionName = new Map(regions.map((r) => [r.id, r.name]));

  const risks: RiskItem[] = [];

  for (const product of products) {
    const cur = currentById.get(product.id) ?? { units: 0, revenue: 0 };
    const prev = previousById.get(product.id) ?? { units: 0, revenue: 0 };
    const change = pctChange(cur.units, prev.units);
    // Stok girilmemiş ürünlerde stok sinyali üretilmez (0 stok ile karıştırılmamalı)
    const stock = stockByProduct.get(product.id) ?? null;
    const velocity = monthlyVelocity(cur.units, COMPARISON_WINDOW_DAYS);
    const months = stock === null ? null : monthsOfCover(stock, velocity);
    const coverage = classifyCoverage(stock, months);

    const signals: RiskSignal[] = [];
    if (change !== null && change <= -RISK_DECLINE_THRESHOLD) signals.push('sales_decline');
    if (coverage === 'excess') signals.push('overstock');
    if (coverage === 'stockout_risk') signals.push('stockout');
    if (signals.length === 0) continue;

    const declined = signals.includes('sales_decline');
    const overstock = signals.includes('overstock');
    const stockout = signals.includes('stockout');

    const avgPrice = cur.units > 0 ? cur.revenue / cur.units : product.listPrice;
    const excessUnits = overstock ? Math.max(0, Math.round(stock! - velocity * TARGET_STOCK_MONTHS)) : 0;
    const shortfallUnits = stockout ? roundUpTo(velocity * TARGET_STOCK_MONTHS - stock!, 10) : 0;
    const weakestRegion = declined
      ? findWeakestRegion(product.id, regionCurrent, regionPrevious, regionName)
      : null;

    // Etki: kaybedilen aylık ciro + fazla stokta bağlı sermaye + tükenirse risk altındaki ciro
    const revenueLoss = declined ? Math.max(0, prev.revenue - cur.revenue) : 0;
    const tiedCapital = excessUnits * product.unitCost;
    const revenueAtRisk = shortfallUnits * avgPrice;
    const impactLabel = [
      declined && 'Aylık ciro kaybı',
      overstock && 'Fazla stokta bağlı sermaye',
      stockout && 'Risk altındaki ciro',
    ]
      .filter(Boolean)
      .join(' + ');

    const name = product.name;
    const message: string[] = [];
    if (declined) {
      message.push(
        `${name} son ${COMPARISON_WINDOW_DAYS} günde ${formatPercent(change!)} daha az sattı ` +
          `(${formatNumber(prev.units)} → ${formatNumber(cur.units)} adet).`,
      );
    } else {
      const trend = change === null ? '' : ` (önceki döneme göre ${formatSignedPercent(change)})`;
      message.push(`${name} son ${COMPARISON_WINDOW_DAYS} günde ${formatNumber(cur.units)} adet sattı${trend}.`);
    }
    if (stock === null) {
      message.push('Bu ürün için stok bilgisi girilmemiş.');
    } else if (months === null) {
      message.push(`Mevcut stok: ${formatNumber(stock)} adet; son ${COMPARISON_WINDOW_DAYS} günde hiç satış olmadı.`);
    } else {
      message.push(
        `Mevcut stok: ${formatNumber(stock)} adet. Mevcut satış hızına göre ~${formatNumber(months, 1)} aylık stok var.`,
      );
    }
    if (weakestRegion) {
      message.push(
        `En büyük düşüş ${weakestRegion.name} bölgesinde (${formatNumber(weakestRegion.unitsDelta)} adet).`,
      );
    }

    let recommendation: string;
    if (overstock && declined) {
      recommendation =
        `Yeni sipariş oluşturma, mevcut stok azaltılmalı: hedef seviyenin (~${TARGET_STOCK_MONTHS} ay) üzerinde ` +
        `~${formatNumber(excessUnits)} adet fazla stok var (≈${formatCurrency(tiedCapital)} bağlı sermaye). ` +
        'Kampanya, paket satış veya tedarikçiye iade seçenekleri değerlendirilmeli.';
    } else if (overstock) {
      recommendation =
        `Bir sonraki satın alma siparişini ertele: hedef seviyenin (~${TARGET_STOCK_MONTHS} ay) üzerinde ` +
        `~${formatNumber(excessUnits)} adet (≈${formatCurrency(tiedCapital)}) fazla stok var.`;
    } else if (stockout) {
      const daysLeft = Math.max(0, Math.floor((months ?? 0) * DAYS_PER_MONTH));
      recommendation =
        `Acil tedarik siparişi oluştur: ~${TARGET_STOCK_MONTHS} aylık stok için ~${formatNumber(shortfallUnits)} adet ` +
        `sipariş önerilir. Mevcut hızla stok ~${daysLeft} gün içinde tükenebilir.` +
        (declined ? ' Sipariş miktarı, düşen talebe göre gözden geçirilmeli.' : '');
    } else {
      recommendation =
        'Düşüşün nedenini araştır' +
        (weakestRegion ? ` (öncelik: ${weakestRegion.name} bölgesi)` : '') +
        ': fiyat, rakip ve kayıp müşteri etkisi kontrol edilmeli; satın alma planı yeni satış hızına göre güncellenmeli.';
    }

    risks.push({
      id: `risk-product-${product.id}`,
      kind: 'risk',
      severity: riskSeverity(signals, change, months),
      signals,
      product: { id: product.id, sku: product.sku, name: product.name, category: product.category },
      title: `${name}: ${TITLES[signals.join('+')] ?? TITLES[signals[0]!]}`,
      message: message.join(' '),
      recommendation,
      impactAmount: round(revenueLoss + tiedCapital + revenueAtRisk),
      impactLabel,
      metrics: {
        currentUnits: cur.units,
        previousUnits: prev.units,
        salesChangePct: change === null ? null : round(change, 4),
        currentRevenue: round(cur.revenue),
        previousRevenue: round(prev.revenue),
        stockUnits: stock,
        monthlyVelocity: round(velocity, 1),
        monthsOfStock: months === null ? null : round(months, 2),
        excessUnits,
        shortfallUnits,
        weakestRegion,
      },
    });
  }

  return risks.sort(compareInsights);
}

function riskSeverity(signals: RiskSignal[], change: number | null, months: number | null): Severity {
  const severeDecline = change !== null && change <= -RISK_DECLINE_THRESHOLD * 2;
  const severeExcess = months === null || months > HIGH_STOCK_MONTHS * 1.5;
  const severeShortage = months !== null && months < LOW_STOCK_MONTHS / 2;

  if (signals.length > 1) return 'high';
  if (signals.includes('sales_decline') && severeDecline) return 'high';
  if (signals.includes('overstock') && severeExcess) return 'high';
  if (signals.includes('stockout') && severeShortage) return 'high';
  return 'medium';
}

function findWeakestRegion(
  productId: number,
  current: { productId: number; regionId: number; units: number }[],
  previous: { productId: number; regionId: number; units: number }[],
  regionName: Map<number, string>,
): { name: string; unitsDelta: number } | null {
  const delta = new Map<number, number>();
  for (const row of current) if (row.productId === productId) delta.set(row.regionId, (delta.get(row.regionId) ?? 0) + row.units);
  for (const row of previous) if (row.productId === productId) delta.set(row.regionId, (delta.get(row.regionId) ?? 0) - row.units);

  let weakest: { regionId: number; unitsDelta: number } | null = null;
  for (const [regionId, unitsDelta] of delta) {
    if (unitsDelta < 0 && (!weakest || unitsDelta < weakest.unitsDelta)) weakest = { regionId, unitsDelta };
  }
  return weakest ? { name: regionName.get(weakest.regionId) ?? '?', unitsDelta: weakest.unitsDelta } : null;
}
