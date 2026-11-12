import { fxFactor } from '../currency/money.js';
import type { DbClient } from '../db/types.js';
import type { DateWindow } from '../utils/dates.js';

/**
 * Satış sorguları. Tüm pencereler (from, to] biçimindedir ve yalnızca teslim edilmiş
 * (iptal edilmemiş) siparişler hesaba katılır. Tutarlar sipariş gününün kuruyla gösterim
 * para birimine çevrilir (bkz. currency/money.ts); satış ve maliyeti aynı kurla çevrildiği
 * için marj oranları para biriminden bağımsız kalır.
 */

export interface ProductSalesRow {
  productId: number;
  units: number;
  revenue: number;
  /** Satılan adetlerin maliyeti (maliyeti girilmemiş ürünlerde 0) */
  cost: number;
}

export interface ProductRegionSalesRow {
  productId: number;
  regionId: number;
  units: number;
  revenue: number;
}

export interface RegionSalesRow {
  regionId: number;
  regionName: string;
  units: number;
  revenue: number;
  orders: number;
}

export interface SalesTotalsRow {
  revenue: number;
  /** Yalnızca maliyeti bilinen (unit_cost > 0) ürünlerin maliyeti */
  cost: number;
  /** Maliyeti bilinen ürünlerin cirosu (brüt kâr bu ciro üzerinden hesaplanır) */
  costedRevenue: number;
  units: number;
  orders: number;
  customers: number;
}

export interface CustomerSalesRow {
  customerId: number;
  revenue: number;
  orders: number;
}

export interface DailySalesRow {
  date: string;
  revenue: number;
  units: number;
}

export async function getLatestOrderDate(db: DbClient): Promise<string | null> {
  const row = await db.queryOne<{ latest: string | null }>(
    `SELECT MAX(order_date) AS latest FROM orders WHERE status = 'delivered'`,
  );
  return row?.latest ?? null;
}

/** Her ürün için (satışı olmasa bile) adet ve ciro. */
export function getProductSales(db: DbClient, window: DateWindow): Promise<ProductSalesRow[]> {
  return db.query<ProductSalesRow>(
    `
    SELECT p.id AS "productId",
           COALESCE(SUM(s.quantity), 0) AS units,
           COALESCE(SUM(s.quantity * s.unit_price), 0) AS revenue,
           COALESCE(SUM(s.quantity * s.unit_cost), 0) AS cost
    FROM products p
    LEFT JOIN (
      SELECT oi.product_id, oi.quantity,
             oi.unit_price * ${fxFactor('o.order_date')} AS unit_price,
             p.unit_cost * ${fxFactor('o.order_date')} AS unit_cost
      FROM order_items oi
      JOIN orders o ON o.id = oi.order_id
      JOIN products p ON p.id = oi.product_id
      WHERE o.status = 'delivered' AND o.order_date > ? AND o.order_date <= ?
    ) s ON s.product_id = p.id
    GROUP BY p.id
    ORDER BY p.id`,
    [window.from, window.to],
  );
}

export function getProductRegionSales(db: DbClient, window: DateWindow): Promise<ProductRegionSalesRow[]> {
  return db.query<ProductRegionSalesRow>(
    `
    SELECT oi.product_id AS "productId",
           o.region_id   AS "regionId",
           SUM(oi.quantity) AS units,
           SUM(oi.quantity * oi.unit_price * ${fxFactor('o.order_date')}) AS revenue
    FROM order_items oi
    JOIN orders o ON o.id = oi.order_id
    WHERE o.status = 'delivered' AND o.order_date > ? AND o.order_date <= ?
    GROUP BY oi.product_id, o.region_id`,
    [window.from, window.to],
  );
}

export function getRegionSales(db: DbClient, window: DateWindow): Promise<RegionSalesRow[]> {
  return db.query<RegionSalesRow>(
    `
    SELECT r.id AS "regionId",
           r.name AS "regionName",
           COALESCE(SUM(t.units), 0) AS units,
           COALESCE(SUM(t.revenue), 0) AS revenue,
           COUNT(t.order_id) AS orders
    FROM regions r
    LEFT JOIN (
      SELECT o.id AS order_id, o.region_id,
             SUM(oi.quantity) AS units,
             SUM(oi.quantity * oi.unit_price * ${fxFactor('o.order_date')}) AS revenue
      FROM orders o
      JOIN order_items oi ON oi.order_id = o.id
      WHERE o.status = 'delivered' AND o.order_date > ? AND o.order_date <= ?
      GROUP BY o.id, o.region_id
    ) t ON t.region_id = r.id
    GROUP BY r.id, r.name
    ORDER BY r.id`,
    [window.from, window.to],
  );
}

export async function getSalesTotals(db: DbClient, window: DateWindow): Promise<SalesTotalsRow> {
  const row = await db.queryOne<SalesTotalsRow>(
    `
    SELECT COALESCE(SUM(oi.quantity * oi.unit_price * ${fxFactor('o.order_date')}), 0) AS revenue,
           COALESCE(SUM(oi.quantity * p.unit_cost * ${fxFactor('o.order_date')}), 0) AS cost,
           COALESCE(SUM(CASE WHEN p.unit_cost > 0 THEN oi.quantity * oi.unit_price * ${fxFactor('o.order_date')} ELSE 0 END), 0) AS "costedRevenue",
           COALESCE(SUM(oi.quantity), 0) AS units,
           COUNT(DISTINCT o.id) AS orders,
           COUNT(DISTINCT o.customer_id) AS customers
    FROM orders o
    JOIN order_items oi ON oi.order_id = o.id
    JOIN products p ON p.id = oi.product_id
    WHERE o.status = 'delivered' AND o.order_date > ? AND o.order_date <= ?`,
    [window.from, window.to],
  );
  return row!;
}

export function getCustomerSales(db: DbClient, window: DateWindow): Promise<CustomerSalesRow[]> {
  return db.query<CustomerSalesRow>(
    `
    SELECT o.customer_id AS "customerId",
           SUM(oi.quantity * oi.unit_price * ${fxFactor('o.order_date')}) AS revenue,
           COUNT(DISTINCT o.id) AS orders
    FROM orders o
    JOIN order_items oi ON oi.order_id = o.id
    WHERE o.status = 'delivered' AND o.order_date > ? AND o.order_date <= ?
    GROUP BY o.customer_id`,
    [window.from, window.to],
  );
}

export function getDailySales(db: DbClient, window: DateWindow): Promise<DailySalesRow[]> {
  return db.query<DailySalesRow>(
    `
    SELECT o.order_date AS date,
           SUM(oi.quantity * oi.unit_price * ${fxFactor('o.order_date')}) AS revenue,
           SUM(oi.quantity) AS units
    FROM orders o
    JOIN order_items oi ON oi.order_id = o.id
    WHERE o.status = 'delivered' AND o.order_date > ? AND o.order_date <= ?
    GROUP BY o.order_date
    ORDER BY o.order_date`,
    [window.from, window.to],
  );
}

/** Bir müşterinin ciroya göre en çok aldığı ürünler. */
export async function getCustomerTopProducts(db: DbClient, customerId: number, limit: number): Promise<string[]> {
  const rows = await db.query<{ name: string }>(
    `
    SELECT p.name AS name
    FROM orders o
    JOIN order_items oi ON oi.order_id = o.id
    JOIN products p ON p.id = oi.product_id
    WHERE o.status = 'delivered' AND o.customer_id = ?
    GROUP BY p.id, p.name
    ORDER BY SUM(oi.quantity * oi.unit_price * ${fxFactor('o.order_date')}) DESC
    LIMIT ?`,
    [customerId, limit],
  );
  return rows.map((row) => row.name);
}
