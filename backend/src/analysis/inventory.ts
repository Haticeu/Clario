import { COMPARISON_WINDOW_DAYS, HIGH_STOCK_MONTHS, LOW_STOCK_MONTHS, TARGET_STOCK_MONTHS } from '../config/thresholds.js';
import type { DbClient } from '../db/types.js';
import { getInventory, getProducts, getRegions } from '../repositories/catalogRepository.js';
import { getProductRegionSales, getProductSales } from '../repositories/salesRepository.js';
import { formatNumber } from '../utils/format.js';
import { groupSum, round, sum } from '../utils/stats.js';
import type { AnalysisContext } from './context.js';
import { detectRisks } from './risks.js';
import { classifyCoverage, monthlyVelocity, monthsOfCover, type CoverageStatus } from './stock.js';
import type { ProductRef, RegionRef } from './types.js';

export interface StockCell {
  regionId: number;
  /** Ürün için hiç stok girilmemişse null */
  stock: number | null;
  monthlyVelocity: number;
  monthsOfStock: number | null;
  status: CoverageStatus;
}

export interface RegionalStockAlert {
  id: string;
  product: ProductRef;
  region: RegionRef;
  status: CoverageStatus;
  stock: number;
  monthsOfStock: number | null;
  message: string;
}

const key = (productId: number, regionId: number) => `${productId}:${regionId}`;

/**
 * Stok zekâsı: ürün toplamı ve ürün × bölge matrisi için "stok kaç ay yeter?" sorusu.
 * Ürün düzeyindeki uyarılar risk motorundan gelir; bölge düzeyinde, ürün toplamı sağlıklı
 * görünse bile tek bir bölgede oluşan dengesizlikler ayrıca raporlanır.
 */
export async function getInventoryIntelligence(db: DbClient, ctx: AnalysisContext) {
  const [products, regions, inventory, productSales, regionSales, risks] = await Promise.all([
    getProducts(db),
    getRegions(db),
    getInventory(db),
    getProductSales(db, ctx.current),
    getProductRegionSales(db, ctx.current),
    detectRisks(db, ctx),
  ]);

  const stockByKey = new Map(inventory.map((r) => [key(r.productId, r.regionId), r.quantity]));
  const unitsByKey = new Map(regionSales.map((r) => [key(r.productId, r.regionId), r.units]));
  const stockByProduct = groupSum(inventory, (r) => r.productId, (r) => r.quantity);
  const unitsByProduct = new Map(productSales.map((r) => [r.productId, r.units]));

  const regionalAlerts: RegionalStockAlert[] = [];

  const rows = products.map((product) => {
    const productRef: ProductRef = { id: product.id, sku: product.sku, name: product.name, category: product.category };
    // Ürüne ait hiç stok kaydı yoksa stok bilinmez (0 stok ile karıştırılmamalı)
    const hasStock = stockByProduct.has(product.id);
    const totalStock = hasStock ? stockByProduct.get(product.id)! : null;
    const velocity = monthlyVelocity(unitsByProduct.get(product.id) ?? 0, COMPARISON_WINDOW_DAYS);
    const months = totalStock === null ? null : monthsOfCover(totalStock, velocity);
    const status = classifyCoverage(totalStock, months);

    const cells: StockCell[] = regions.map((region) => {
      const stock = hasStock ? (stockByKey.get(key(product.id, region.id)) ?? 0) : null;
      const cellVelocity = monthlyVelocity(unitsByKey.get(key(product.id, region.id)) ?? 0, COMPARISON_WINDOW_DAYS);
      const cellMonths = stock === null ? null : monthsOfCover(stock, cellVelocity);
      const cellStatus = classifyCoverage(stock, cellMonths);

      if (cellStatus !== status && (cellStatus === 'stockout_risk' || cellStatus === 'excess')) {
        regionalAlerts.push({
          id: `stock-${product.id}-${region.id}`,
          product: productRef,
          region: { id: region.id, name: region.name },
          status: cellStatus,
          stock: stock ?? 0,
          monthsOfStock: cellMonths === null ? null : round(cellMonths, 2),
          message:
            cellMonths === null
              ? `${region.name} bölgesinde ${product.name} için ${formatNumber(stock ?? 0)} adet stok var ancak son ${COMPARISON_WINDOW_DAYS} günde satış yok.`
              : `${region.name} bölgesinde ${product.name} stoğu ~${formatNumber(cellMonths, 1)} aylık ` +
                `(${formatNumber(stock ?? 0)} adet); ürünün genel durumu ise ${STATUS_LABELS[status].toLowerCase()}.`,
        });
      }

      return {
        regionId: region.id,
        stock,
        monthlyVelocity: round(cellVelocity, 1),
        monthsOfStock: cellMonths === null ? null : round(cellMonths, 2),
        status: cellStatus,
      };
    });

    return {
      product: productRef,
      totalStock,
      stockValue: round((totalStock ?? 0) * product.unitCost),
      monthlyVelocity: round(velocity, 1),
      monthsOfStock: months === null ? null : round(months, 2),
      status,
      cells,
    };
  });

  const stockAlerts = risks.filter((r) => r.signals.includes('overstock') || r.signals.includes('stockout'));
  const excessValue = sum(
    stockAlerts.map((r) => r.metrics.excessUnits * (products.find((p) => p.id === r.product.id)?.unitCost ?? 0)),
  );

  return {
    asOf: ctx.asOf,
    thresholds: { lowStockMonths: LOW_STOCK_MONTHS, highStockMonths: HIGH_STOCK_MONTHS, targetStockMonths: TARGET_STOCK_MONTHS },
    summary: {
      totalUnits: sum(rows.map((r) => r.totalStock ?? 0)),
      totalValue: round(sum(rows.map((r) => r.stockValue))),
      excessValue: round(excessValue),
      statusCounts: {
        stockoutRisk: rows.filter((r) => r.status === 'stockout_risk').length,
        excess: rows.filter((r) => r.status === 'excess').length,
        healthy: rows.filter((r) => r.status === 'healthy').length,
        inactive: rows.filter((r) => r.status === 'inactive').length,
        unknown: rows.filter((r) => r.status === 'unknown').length,
      },
    },
    alerts: stockAlerts,
    // Tükenme riskleri, fazla stok uyarılarından önce
    regionalAlerts: regionalAlerts.sort(
      (a, b) => Number(b.status === 'stockout_risk') - Number(a.status === 'stockout_risk'),
    ),
    regions: regions.map((r) => ({ id: r.id, name: r.name })),
    products: rows,
  };
}

const STATUS_LABELS: Record<CoverageStatus, string> = {
  stockout_risk: 'Tükenme riski',
  excess: 'Fazla stok',
  healthy: 'Sağlıklı',
  inactive: 'Hareketsiz',
  unknown: 'Stok bilgisi yok',
};
