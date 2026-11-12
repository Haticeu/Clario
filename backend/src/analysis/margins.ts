import { LOW_MARGIN_THRESHOLD, MARGIN_WINDOW_DAYS } from '../config/thresholds.js';
import type { DbClient } from '../db/types.js';
import { getProducts } from '../repositories/catalogRepository.js';
import { getProductSales } from '../repositories/salesRepository.js';
import { addDays } from '../utils/dates.js';
import { round } from '../utils/stats.js';
import type { AnalysisContext } from './context.js';
import type { ProductRef } from './types.js';

export type MarginStatus = 'loss' | 'low' | 'healthy';

export interface MarginItem {
  product: ProductRef;
  unitsSold: number;
  revenue: number;
  unitCost: number;
  listPrice: number;
  /** Gerçekleşen ortalama satış fiyatı (iskontolar sonrası). */
  avgSellingPrice: number;
  /** Liste fiyatına göre ortalama iskonto oranı. */
  avgDiscountPct: number;
  /** Brüt marj = (ort. satış fiyatı − maliyet) / ort. satış fiyatı */
  marginPct: number;
  grossProfit: number;
  status: MarginStatus;
}

/**
 * Marj analizi: son MARGIN_WINDOW_DAYS gündeki gerçekleşen ortalama satış fiyatını
 * birim maliyetle karşılaştırır. En düşük marjlı ürün başta olacak şekilde sıralanır.
 */
export async function getMarginAnalysis(db: DbClient, ctx: AnalysisContext): Promise<MarginItem[]> {
  const window = { from: addDays(ctx.asOf, -MARGIN_WINDOW_DAYS), to: ctx.asOf };
  const [products, sales] = await Promise.all([getProducts(db), getProductSales(db, window)]);
  const salesById = new Map(sales.map((s) => [s.productId, s]));

  const items: MarginItem[] = [];
  for (const product of products) {
    const row = salesById.get(product.id);
    if (!row || row.units === 0) continue;
    // Maliyeti bilinmeyen (0 girilmiş) ürünler marj analizine dahil edilmez; aksi halde %100 kâr görünürdü.
    if (product.unitCost <= 0) continue;

    const avgPrice = row.revenue / row.units;
    // Maliyet satış satırlarıyla aynı (sipariş günü) kurla çevrilir; ana para biriminde birim maliyete eşittir.
    const avgUnitCost = row.cost / row.units;
    // Liste fiyatını da aynı dönem kuruna getir, yoksa kur değişimi iskonto gibi görünürdü
    const listPrice = product.listPrice * (avgUnitCost / product.unitCost);
    const margin = (row.revenue - row.cost) / row.revenue;
    items.push({
      product: { id: product.id, sku: product.sku, name: product.name, category: product.category },
      unitsSold: row.units,
      revenue: round(row.revenue),
      unitCost: round(avgUnitCost, 2),
      listPrice: round(listPrice, 2),
      avgSellingPrice: round(avgPrice, 2),
      avgDiscountPct: round(1 - avgPrice / listPrice, 4),
      marginPct: round(margin, 4),
      grossProfit: round(row.revenue - row.cost),
      status: margin < 0 ? 'loss' : margin < LOW_MARGIN_THRESHOLD ? 'low' : 'healthy',
    });
  }

  return items.sort((a, b) => a.marginPct - b.marginPct);
}
