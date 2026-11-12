import {
  COMPARISON_WINDOW_DAYS,
  DAYS_PER_MONTH,
  DONOR_MIN_STOCK_MONTHS,
  OPPORTUNITY_BASELINE_WEEKS,
  OPPORTUNITY_GROWTH_THRESHOLD,
  OPPORTUNITY_MIN_BASE_UNITS,
  OPPORTUNITY_MIN_Z_SCORE,
  OPPORTUNITY_WINDOW_DAYS,
  TARGET_STOCK_MONTHS,
  TRANSFER_ROUNDING_UNITS,
} from '../config/thresholds.js';
import type { DbClient } from '../db/types.js';
import { getInventory, getProducts, getRegions } from '../repositories/catalogRepository.js';
import { getProductRegionSales, type ProductRegionSalesRow } from '../repositories/salesRepository.js';
import { addDays } from '../utils/dates.js';
import { formatCurrency, formatNumber, formatPercent } from '../utils/format.js';
import { round, roundDownTo, standardDeviation } from '../utils/stats.js';
import type { AnalysisContext } from './context.js';
import { monthlyVelocity, monthsOfCover } from './stock.js';
import { compareInsights, type InsightBase, type ProductRef, type RegionRef } from './types.js';

export interface StockTransfer {
  fromRegion: RegionRef;
  units: number;
  donorStock: number;
  donorMonthsOfStock: number | null;
}

export interface OpportunityItem extends InsightBase {
  kind: 'opportunity';
  product: ProductRef;
  region: RegionRef;
  metrics: {
    currentUnits: number;
    previousUnits: number;
    growthPct: number;
    /** Son pencerenin, önceki OPPORTUNITY_BASELINE_WEEKS haftalık ortalamaya göre artışı. */
    baselineGrowthPct: number;
    /** Artışın olağan dalgalanmaya göre kaç standart sapma olduğu (dalgalanma yoksa null). */
    zScore: number | null;
    /** Ürün için hiç stok girilmemişse null */
    regionStock: number | null;
    /** Bölge stoğunun, YENİ satış hızına göre kaç ay yettiği. */
    regionMonthsOfStock: number | null;
    /** Hedef stok seviyesine ulaşmak için gereken ek adet. */
    unitsNeeded: number;
    transfer: StockTransfer | null;
  };
}

const key = (productId: number, regionId: number) => `${productId}:${regionId}`;

function indexSales(rows: ProductRegionSalesRow[]) {
  return new Map(rows.map((r) => [key(r.productId, r.regionId), r]));
}

/**
 * Son pencere satışının, haftalık geçmişe göre ne kadar olağandışı olduğunu ölçer.
 * Beklenen = haftalık ortalama × pencere haftası; sapma = haftalık std × √(pencere haftası).
 */
export function significanceVsBaseline(windowUnits: number, weeklyUnits: number[]) {
  const windowWeeks = OPPORTUNITY_WINDOW_DAYS / 7;
  const mean = weeklyUnits.reduce((t, u) => t + u, 0) / weeklyUnits.length;
  const expected = mean * windowWeeks;
  const sd = standardDeviation(weeklyUnits) * Math.sqrt(windowWeeks);
  const zScore = sd > 0 ? (windowUnits - expected) / sd : windowUnits > expected ? Infinity : 0;
  return { expected, zScore };
}

/**
 * Fırsat tespiti: bir ürün-bölge kombinasyonunun son 3 haftalık satışı önceki 3 haftaya
 * göre >= OPPORTUNITY_GROWTH_THRESHOLD artmışsa fırsattır. Tesadüfi dalgalanmaları elemek
 * için artışın, önceki OPPORTUNITY_BASELINE_WEEKS haftanın olağan dalgalanmasına göre de
 * anlamlı olması (z >= OPPORTUNITY_MIN_Z_SCORE) gerekir. Artan talebi karşılamak için
 * aynı ürünün EN FAZLA STOĞA sahip diğer bölgesinden, o bölgenin kendi ihtiyacını
 * (DONOR_MIN_STOCK_MONTHS) koruyacak kadar stok aktarımı önerilir.
 */
export async function detectOpportunities(db: DbClient, ctx: AnalysisContext): Promise<OpportunityItem[]> {
  const baselineWeekWindows = Array.from({ length: OPPORTUNITY_BASELINE_WEEKS }, (_, i) => {
    const to = addDays(ctx.opportunityCurrent.from, -7 * i);
    return { from: addDays(to, -7), to };
  });

  const [products, regions, inventory, current, previous, last30, ...baselineWeeks] = await Promise.all([
    getProducts(db),
    getRegions(db),
    getInventory(db),
    getProductRegionSales(db, ctx.opportunityCurrent),
    getProductRegionSales(db, ctx.opportunityPrevious),
    getProductRegionSales(db, ctx.current),
    ...baselineWeekWindows.map((window) => getProductRegionSales(db, window)),
  ]);

  const currentByKey = indexSales(current);
  const previousByKey = indexSales(previous);
  const last30ByKey = indexSales(last30);
  const baselineWeekIndexes = baselineWeeks.map(indexSales);
  const weeklyUnits = (k: string) => baselineWeekIndexes.map((week) => week.get(k)?.units ?? 0);
  const stockByKey = new Map(inventory.map((r) => [key(r.productId, r.regionId), r.quantity]));
  const productsWithStock = new Set(inventory.map((r) => r.productId));
  const weeks = Math.round(OPPORTUNITY_WINDOW_DAYS / 7);

  const opportunities: OpportunityItem[] = [];

  for (const product of products) {
    for (const region of regions) {
      const cur = currentByKey.get(key(product.id, region.id));
      const prev = previousByKey.get(key(product.id, region.id));
      if (!cur || !prev || prev.units < OPPORTUNITY_MIN_BASE_UNITS) continue;

      const growth = (cur.units - prev.units) / prev.units;
      if (growth < OPPORTUNITY_GROWTH_THRESHOLD) continue;

      const { expected, zScore } = significanceVsBaseline(cur.units, weeklyUnits(key(product.id, region.id)));
      if (zScore < OPPORTUNITY_MIN_Z_SCORE) continue;
      const baselineGrowth = expected > 0 ? (cur.units - expected) / expected : 0;

      // Yeni (artmış) satış hızına göre bölgenin ihtiyacı
      // Ürün için hiç stok girilmemişse transfer/sipariş önerisi hesaplanamaz
      const hasStock = productsWithStock.has(product.id);
      const regionStock = hasStock ? (stockByKey.get(key(product.id, region.id)) ?? 0) : null;
      const newVelocity = monthlyVelocity(cur.units, OPPORTUNITY_WINDOW_DAYS);
      const regionMonths = regionStock === null ? null : monthsOfCover(regionStock, newVelocity);
      const unitsNeeded = regionStock === null ? 0 : Math.max(0, Math.ceil(newVelocity * TARGET_STOCK_MONTHS - regionStock));

      const transfer = unitsNeeded > 0 ? findDonor(product.id, region.id, unitsNeeded) : null;

      const extraMonthlyRevenue = (cur.revenue - prev.revenue) * (DAYS_PER_MONTH / OPPORTUNITY_WINDOW_DAYS);

      const message =
        `${region.name} bölgesinde ${product.name} satışı son ${weeks} haftada ${formatPercent(growth)} arttı ` +
        `(${formatNumber(prev.units)} → ${formatNumber(cur.units)} adet). ` +
        (regionStock === null
          ? 'Bu ürün için stok bilgisi girilmemiş.'
          : `Bölge stoğu: ${formatNumber(regionStock)} adet` +
            (regionMonths === null ? '.' : ` (yeni satış hızıyla ~${formatNumber(regionMonths, 1)} aylık).`));

      let recommendation: string;
      if (regionStock === null) {
        recommendation =
          `Artan talebi karşılamak için ${region.name} bölgesinde stok ve kampanya planlayın. Stok bilgisi girilirse ` +
          'bölgeler arası transfer ve sipariş miktarı da önerilir.';
      } else if (transfer) {
        recommendation =
          `${transfer.fromRegion.name} bölgesinden ${region.name} bölgesine +${formatNumber(transfer.units)} adet ` +
          `stok aktarımı yapılabilir (${transfer.fromRegion.name} stoğu: ${formatNumber(transfer.donorStock)} adet` +
          (transfer.donorMonthsOfStock === null ? ')' : `, ~${formatNumber(transfer.donorMonthsOfStock, 1)} aylık)`) +
          `. Talep sürerse aylık ~${formatCurrency(extraMonthlyRevenue)} ek ciro potansiyeli var.`;
        if (unitsNeeded - transfer.units > TRANSFER_ROUNDING_UNITS) {
          recommendation += ` Kalan ~${formatNumber(unitsNeeded - transfer.units)} adet için tedarikçi siparişi verilmeli.`;
        }
      } else if (unitsNeeded > 0) {
        recommendation =
          `Diğer bölgelerde aktarılabilir fazla stok yok; ${region.name} için tedarikçiden ` +
          `~${formatNumber(unitsNeeded)} adet ek sipariş verilmeli.`;
      } else {
        recommendation =
          `Bölge stoğu artan talebi karşılıyor. Büyümeyi sürdürmek için ${region.name} ekibi ` +
          'bu ürüne yönelik kampanya ve raf görünürlüğünü artırabilir.';
      }

      opportunities.push({
        id: `opportunity-${product.id}-${region.id}`,
        kind: 'opportunity',
        severity: growth >= OPPORTUNITY_GROWTH_THRESHOLD * 2 ? 'high' : 'medium',
        product: { id: product.id, sku: product.sku, name: product.name, category: product.category },
        region: { id: region.id, name: region.name },
        title: `${region.name}: ${product.name} talebi artıyor`,
        message,
        recommendation,
        impactAmount: round(Math.max(0, extraMonthlyRevenue)),
        impactLabel: 'Aylık ek ciro potansiyeli',
        metrics: {
          currentUnits: cur.units,
          previousUnits: prev.units,
          growthPct: round(growth, 4),
          baselineGrowthPct: round(baselineGrowth, 4),
          zScore: Number.isFinite(zScore) ? round(zScore, 2) : null,
          regionStock,
          regionMonthsOfStock: regionMonths === null ? null : round(regionMonths, 2),
          unitsNeeded,
          transfer,
        },
      });
    }
  }

  return opportunities.sort(compareInsights);

  function findDonor(productId: number, targetRegionId: number, unitsNeeded: number): StockTransfer | null {
    // Spesifikasyon: diğer bölgelerden en fazla stoğu olan seçilir.
    const donor = regions
      .filter((r) => r.id !== targetRegionId)
      .map((r) => ({ region: r, stock: stockByKey.get(key(productId, r.id)) ?? 0 }))
      .sort((a, b) => b.stock - a.stock)[0];
    if (!donor || donor.stock === 0) return null;

    const donorVelocity = monthlyVelocity(last30ByKey.get(key(productId, donor.region.id))?.units ?? 0, COMPARISON_WINDOW_DAYS);
    const donorSurplus = donor.stock - donorVelocity * DONOR_MIN_STOCK_MONTHS;
    const units = roundDownTo(Math.min(unitsNeeded, donorSurplus), TRANSFER_ROUNDING_UNITS);
    if (units <= 0) return null;

    const donorMonths = monthsOfCover(donor.stock, donorVelocity);
    return {
      fromRegion: { id: donor.region.id, name: donor.region.name },
      units,
      donorStock: donor.stock,
      donorMonthsOfStock: donorMonths === null ? null : round(donorMonths, 2),
    };
  }
}
