import { DAYS_PER_MONTH, HIGH_STOCK_MONTHS, LOW_STOCK_MONTHS } from '../config/thresholds.js';

/** unknown: bu ürün için hiç stok bilgisi girilmemiş (0 stok ile karıştırılmamalı) */
export type CoverageStatus = 'stockout_risk' | 'excess' | 'healthy' | 'inactive' | 'unknown';

/** Bir penceredeki satış adedini aylık satış hızına çevirir. */
export function monthlyVelocity(unitsInWindow: number, windowDays: number): number {
  return (unitsInWindow / windowDays) * DAYS_PER_MONTH;
}

/** Stok kaç ay yeter? Satış yoksa tanımsızdır (null). */
export function monthsOfCover(stock: number, velocity: number): number | null {
  return velocity > 0 ? stock / velocity : null;
}

/**
 * Stok kapsamı sınıflandırması. Satışı olmayan ama stoğu olan ürün "ölü stok"
 * olduğu için fazla stok sayılır. Stok hiç girilmemişse (null) durum bilinmez.
 */
export function classifyCoverage(stock: number | null, months: number | null): CoverageStatus {
  if (stock === null) return 'unknown';
  if (months === null) return stock > 0 ? 'excess' : 'inactive';
  if (months < LOW_STOCK_MONTHS) return 'stockout_risk';
  if (months > HIGH_STOCK_MONTHS) return 'excess';
  return 'healthy';
}
