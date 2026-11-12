import { convertLatest } from '../currency/money.js';
import type { DbClient } from '../db/types.js';

export interface ProductRow {
  id: number;
  sku: string;
  name: string;
  category: string;
  unitCost: number;
  listPrice: number;
}

export interface RegionRow {
  id: number;
  name: string;
}

export interface InventoryRow {
  productId: number;
  regionId: number;
  quantity: number;
}

export interface RecordCounts {
  regions: number;
  products: number;
  customers: number;
  employees: number;
  orders: number;
  expenses: number;
}

/** Ürünler; maliyet ve liste fiyatı güncel kurla gösterim para birimine çevrilmiş olarak. */
export async function getProducts(db: DbClient): Promise<ProductRow[]> {
  const rows = await db.query<ProductRow>(`
    SELECT id, sku, name, category, unit_cost AS "unitCost", list_price AS "listPrice"
    FROM products
    ORDER BY id`);
  return rows.map((row) => ({ ...row, unitCost: convertLatest(row.unitCost), listPrice: convertLatest(row.listPrice) }));
}

export function getRegions(db: DbClient): Promise<RegionRow[]> {
  return db.query<RegionRow>('SELECT id, name FROM regions ORDER BY id');
}

export function getInventory(db: DbClient): Promise<InventoryRow[]> {
  return db.query<InventoryRow>(`
    SELECT product_id AS "productId", region_id AS "regionId", quantity
    FROM inventory
    ORDER BY product_id, region_id`);
}

export async function getRecordCounts(db: DbClient): Promise<RecordCounts> {
  const row = await db.queryOne<RecordCounts>(`
    SELECT
      (SELECT COUNT(*) FROM regions)   AS regions,
      (SELECT COUNT(*) FROM products)  AS products,
      (SELECT COUNT(*) FROM customers) AS customers,
      (SELECT COUNT(*) FROM employees) AS employees,
      (SELECT COUNT(*) FROM orders)    AS orders,
      (SELECT COUNT(*) FROM expenses)  AS expenses`);
  return row!;
}
