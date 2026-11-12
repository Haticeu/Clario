import { fxFactor } from '../currency/money.js';
import type { DbClient } from '../db/types.js';
import type { DateWindow } from '../utils/dates.js';

/** Satış ve giderlerin gruplanabildiği boyutlar (sütun adları beyaz listedir). */
export type SegmentDimension = 'department' | 'project';

export interface SegmentSalesRow {
  /** null: departman/proje girilmemiş kayıtlar */
  name: string | null;
  revenue: number;
  /** Maliyeti bilinen ürünlerin maliyeti */
  productCost: number;
  /** Maliyeti bilinen ürünlerin cirosu */
  costedRevenue: number;
  orders: number;
}

export interface SegmentExpenseRow {
  name: string | null;
  amount: number;
}

/** Teslim edilmiş siparişlerin departman veya projeye göre cirosu ve ürün maliyeti; window (from, to]. */
export function getSalesBySegment(db: DbClient, dimension: SegmentDimension, window: DateWindow): Promise<SegmentSalesRow[]> {
  const fx = fxFactor('o.order_date');
  return db.query<SegmentSalesRow>(
    `
    SELECT o.${dimension} AS name,
           SUM(oi.quantity * oi.unit_price * ${fx}) AS revenue,
           SUM(oi.quantity * p.unit_cost * ${fx}) AS "productCost",
           SUM(CASE WHEN p.unit_cost > 0 THEN oi.quantity * oi.unit_price * ${fx} ELSE 0 END) AS "costedRevenue",
           COUNT(DISTINCT o.id) AS orders
    FROM orders o
    JOIN order_items oi ON oi.order_id = o.id
    JOIN products p ON p.id = oi.product_id
    WHERE o.status = 'delivered' AND o.order_date > ? AND o.order_date <= ?
    GROUP BY o.${dimension}`,
    [window.from, window.to],
  );
}

/** Giderlerin departman veya projeye göre toplamı; window (from, to]. */
export function getExpensesBySegment(db: DbClient, dimension: SegmentDimension, window: DateWindow): Promise<SegmentExpenseRow[]> {
  return db.query<SegmentExpenseRow>(
    `
    SELECT ${dimension} AS name, SUM(amount * ${fxFactor('expense_date')}) AS amount
    FROM expenses
    WHERE expense_date > ? AND expense_date <= ?
    GROUP BY ${dimension}`,
    [window.from, window.to],
  );
}
