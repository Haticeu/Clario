import { fxFactor } from '../currency/money.js';
import type { DbClient, SqlParam } from '../db/types.js';

/** Rapor filtresi. Boş alanlar filtre uygulanmadığı anlamına gelir. */
export interface ReportFilter {
  /** Satış durumu: varsayılan yalnızca teslim edilenler */
  status: 'delivered' | 'cancelled' | 'all';
  category?: string;
  productId?: number;
  customerId?: number;
  customerType?: string;
  regionId?: number;
  /** NONE_VALUE: departmanı girilmemiş satışlar */
  department?: string;
  project?: string;
}

/** Departman/proje filtresinde "Atanmamış" (boş) kayıtları seçmek için kullanılan değer */
export const NONE_VALUE = '__none__';

export interface Period {
  /** Dahil */
  from: string;
  /** Dahil */
  to: string;
}

/**
 * Filtreye uyan satış satırları (CTE). Bütün rapor sorguları bunun üzerinde çalışır; böylece toplamlar,
 * zaman serisi ve kırılımlar her zaman aynı filtreyle tutarlıdır. Tüm değerler parametre olarak geçer.
 * Tutarlar sipariş gününün kuruyla gösterim para birimine çevrilir.
 */
function filteredLines(filter: ReportFilter, period: Period): { cte: string; params: SqlParam[] } {
  const fx = fxFactor('o.order_date');
  const conditions = ['o.order_date >= ?', 'o.order_date <= ?'];
  const params: SqlParam[] = [period.from, period.to];
  const add = (condition: string, value?: SqlParam) => {
    conditions.push(condition);
    if (value !== undefined) params.push(value);
  };

  if (filter.status !== 'all') add('o.status = ?', filter.status);
  if (filter.category) add('p.category = ?', filter.category);
  if (filter.productId) add('oi.product_id = ?', filter.productId);
  if (filter.customerId) add('o.customer_id = ?', filter.customerId);
  if (filter.customerType) add('c.customer_type = ?', filter.customerType);
  if (filter.regionId) add('o.region_id = ?', filter.regionId);
  if (filter.department) filter.department === NONE_VALUE ? add('o.department IS NULL') : add('o.department = ?', filter.department);
  if (filter.project) filter.project === NONE_VALUE ? add('o.project IS NULL') : add('o.project = ?', filter.project);

  const cte = `
    WITH lines AS (
      SELECT o.id AS order_id, o.order_no, o.order_date, o.status, o.customer_id, c.name AS customer_name,
             c.customer_type, o.region_id, r.name AS region_name, o.department, o.project,
             oi.product_id, p.name AS product_name, p.category, oi.quantity,
             oi.quantity * oi.unit_price * ${fx} AS revenue,
             oi.quantity * p.unit_cost * ${fx} AS cost,
             CASE WHEN p.unit_cost > 0 THEN oi.quantity * oi.unit_price * ${fx} ELSE 0 END AS costed_revenue
      FROM orders o
      JOIN order_items oi ON oi.order_id = o.id
      JOIN products p ON p.id = oi.product_id
      JOIN customers c ON c.id = o.customer_id
      JOIN regions r ON r.id = o.region_id
      WHERE ${conditions.join(' AND ')}
    )`;
  return { cte, params };
}

export interface ReportTotalsRow {
  revenue: number;
  cost: number;
  costedRevenue: number;
  units: number;
  orders: number;
  customers: number;
}

export async function getReportTotals(db: DbClient, filter: ReportFilter, period: Period): Promise<ReportTotalsRow> {
  const { cte, params } = filteredLines(filter, period);
  const row = await db.queryOne<ReportTotalsRow>(
    `${cte}
    SELECT COALESCE(SUM(revenue), 0) AS revenue, COALESCE(SUM(cost), 0) AS cost,
           COALESCE(SUM(costed_revenue), 0) AS "costedRevenue", COALESCE(SUM(quantity), 0) AS units,
           COUNT(DISTINCT order_id) AS orders, COUNT(DISTINCT customer_id) AS customers
    FROM lines`,
    params,
  );
  return row!;
}

export interface ReportDailyRow {
  date: string;
  revenue: number;
  orders: number;
  units: number;
}

export function getReportDaily(db: DbClient, filter: ReportFilter, period: Period): Promise<ReportDailyRow[]> {
  const { cte, params } = filteredLines(filter, period);
  return db.query<ReportDailyRow>(
    `${cte}
    SELECT order_date AS date, SUM(revenue) AS revenue, COUNT(DISTINCT order_id) AS orders, SUM(quantity) AS units
    FROM lines GROUP BY order_date ORDER BY order_date`,
    params,
  );
}

/** Kırılım boyutları: anahtar ve görünen ad sütunu (beyaz liste; SQL'e yalnızca bunlar yazılır) */
export const REPORT_DIMENSIONS = {
  category: { key: 'category', label: 'category' },
  product: { key: 'product_id', label: 'product_name' },
  customer: { key: 'customer_id', label: 'customer_name' },
  customerType: { key: 'customer_type', label: 'customer_type' },
  region: { key: 'region_id', label: 'region_name' },
  department: { key: 'department', label: 'department' },
  project: { key: 'project', label: 'project' },
} as const;

export type ReportDimension = keyof typeof REPORT_DIMENSIONS;

export interface ReportBreakdownRow {
  key: string | number | null;
  name: string | null;
  revenue: number;
  units: number;
  orders: number;
  cost: number;
  costedRevenue: number;
}

export function getReportBreakdown(
  db: DbClient,
  filter: ReportFilter,
  period: Period,
  dimension: ReportDimension,
  limit: number,
): Promise<ReportBreakdownRow[]> {
  const { key, label } = REPORT_DIMENSIONS[dimension];
  const { cte, params } = filteredLines(filter, period);
  return db.query<ReportBreakdownRow>(
    `${cte}
    SELECT ${key} AS key, ${label} AS name, SUM(revenue) AS revenue, SUM(quantity) AS units,
           COUNT(DISTINCT order_id) AS orders, SUM(cost) AS cost, SUM(costed_revenue) AS "costedRevenue"
    FROM lines GROUP BY ${key}, ${label} ORDER BY revenue DESC LIMIT ?`,
    [...params, limit],
  );
}

export interface ReportOrderRow {
  id: number;
  orderNo: string | null;
  date: string;
  status: 'delivered' | 'cancelled';
  customer: string;
  region: string;
  department: string | null;
  project: string | null;
  items: number;
  amount: number;
}

export async function getReportOrders(
  db: DbClient,
  filter: ReportFilter,
  period: Period,
  limit: number,
  offset: number,
): Promise<{ total: number; items: ReportOrderRow[] }> {
  const { cte, params } = filteredLines(filter, period);
  const [count, items] = await Promise.all([
    db.queryOne<{ n: number }>(`${cte} SELECT COUNT(DISTINCT order_id) AS n FROM lines`, params),
    db.query<ReportOrderRow>(
      `${cte}
      SELECT order_id AS id, order_no AS "orderNo", order_date AS date, status, customer_name AS customer,
             region_name AS region, department, project, COUNT(*) AS items, SUM(revenue) AS amount
      FROM lines
      GROUP BY order_id, order_no, order_date, status, customer_name, region_name, department, project
      ORDER BY order_date DESC, order_id DESC
      LIMIT ? OFFSET ?`,
      [...params, limit, offset],
    ),
  ]);
  return { total: count?.n ?? 0, items };
}

/**
 * Dönemdeki giderler. Giderler ürüne veya müşteriye bağlı olmadığı için yalnızca dönem, departman, proje ve
 * bölge filtreleri uygulanabilir; diğer filtreler varsa gider hesaplanmaz (null).
 */
export async function getReportExpenses(db: DbClient, filter: ReportFilter, period: Period): Promise<number | null> {
  if (filter.category || filter.productId || filter.customerId || filter.customerType || filter.status === 'cancelled') return null;
  const conditions = ['expense_date >= ?', 'expense_date <= ?'];
  const params: SqlParam[] = [period.from, period.to];
  if (filter.regionId) {
    conditions.push('region_id = ?');
    params.push(filter.regionId);
  }
  for (const column of ['department', 'project'] as const) {
    const value = filter[column];
    if (!value) continue;
    if (value === NONE_VALUE) conditions.push(`${column} IS NULL`);
    else {
      conditions.push(`${column} = ?`);
      params.push(value);
    }
  }
  const row = await db.queryOne<{ total: number }>(
    `SELECT COALESCE(SUM(amount * ${fxFactor('expense_date')}), 0) AS total FROM expenses WHERE ${conditions.join(' AND ')}`,
    params,
  );
  return row?.total ?? 0;
}

// ── Filtre seçenekleri ──

export interface ReportOptionsRow {
  categories: string[];
  products: { id: number; name: string; category: string }[];
  customers: { id: number; name: string }[];
  regions: { id: number; name: string }[];
  departments: string[];
  projects: string[];
  dataRange: { from: string | null; to: string | null };
}

export async function getReportOptions(db: DbClient): Promise<ReportOptionsRow> {
  const [categories, products, customers, regions, departments, projects, range] = await Promise.all([
    db.query<{ value: string }>('SELECT DISTINCT category AS value FROM products ORDER BY category'),
    db.query<{ id: number; name: string; category: string }>('SELECT id, name, category FROM products ORDER BY name'),
    db.query<{ id: number; name: string }>('SELECT id, name FROM customers ORDER BY name'),
    db.query<{ id: number; name: string }>('SELECT id, name FROM regions ORDER BY name'),
    db.query<{ value: string }>(
      'SELECT department AS value FROM orders WHERE department IS NOT NULL UNION SELECT department FROM expenses WHERE department IS NOT NULL ORDER BY value',
    ),
    db.query<{ value: string }>(
      'SELECT project AS value FROM orders WHERE project IS NOT NULL UNION SELECT project FROM expenses WHERE project IS NOT NULL ORDER BY value',
    ),
    db.queryOne<{ from: string | null; to: string | null }>('SELECT MIN(order_date) AS "from", MAX(order_date) AS "to" FROM orders'),
  ]);
  return {
    categories: categories.map((r) => r.value),
    products,
    customers,
    regions,
    departments: departments.map((r) => r.value),
    projects: projects.map((r) => r.value),
    dataRange: range ?? { from: null, to: null },
  };
}
