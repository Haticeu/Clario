import { normalizeText, tokenize } from '../assistant/text.js';
import { fxFactor } from '../currency/money.js';
import type { DbClient, SqlParam } from '../db/types.js';
import { round } from '../utils/stats.js';

const roundMoney = (value: number) => round(value, 2);

/**
 * Genel arama (üst çubuktaki arama kutusu): müşteri, işlem (sipariş), ürün, kategori, bölge, departman/proje ve
 * giderlerde arar. Türkçe karakterler ve büyük/küçük harf fark etmez ("ozturk" → "Öztürk"). Tutarlar gösterim
 * para birimindedir (her kayıt kendi tarihindeki kurla).
 */

export interface SearchResults {
  query: string;
  customers: { id: number; name: string; customerType: string; regionName: string; orders: number; revenue: number; lastOrderDate: string | null }[];
  orders: OrderSummary[];
  products: { id: number; sku: string; name: string; category: string; quantity: number; revenue: number }[];
  categories: { name: string; products: number; revenue: number }[];
  regions: { id: number; name: string; revenue: number }[];
  groups: { kind: 'department' | 'project'; name: string; revenue: number }[];
  /** Aynı açıklama ve türdeki giderler tek satırda (ör. her ay ödenen kira) */
  expenses: { description: string | null; category: string; project: string | null; count: number; total: number; lastDate: string }[];
  total: number;
}

export interface OrderSummary {
  id: number;
  orderNo: string | null;
  date: string;
  status: 'delivered' | 'cancelled';
  customerId: number;
  customerName: string;
  regionName: string;
  department: string | null;
  project: string | null;
  items: number;
  total: number;
}

export interface OrderDetail extends OrderSummary {
  salesRepName: string | null;
  lines: { productId: number; sku: string; name: string; category: string; quantity: number; unitPrice: number; total: number }[];
}

const LIMIT = 6;
const ORDER_LIMIT = 8;
export const MIN_QUERY = 2;
export const MAX_QUERY = 100;

/** Sorgudaki her kelime metindeki bir kelimenin başıyla eşleşiyor mu ("ist" → "İstanbul", "Lojistik" değil) */
function matcher(query: string) {
  const tokens = tokenize(normalizeText(query));
  return (text: string | null | undefined): number => {
    if (!text || tokens.length === 0) return 0;
    const normalized = normalizeText(text);
    const words = tokenize(normalized);
    if (!tokens.every((t) => words.some((w) => w.startsWith(t)))) return 0;
    if (normalized === tokens.join(' ')) return 3;
    return words[0]!.startsWith(tokens[0]!) ? 2 : 1;
  };
}

function best<T>(rows: T[], score: (row: T) => number, limit = LIMIT): T[] {
  return rows
    .map((row) => ({ row, s: score(row) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s)
    .slice(0, limit)
    .map((x) => x.row);
}

const placeholders = (n: number) => Array.from({ length: n }, () => '?').join(', ');

const ORDER_SELECT = (fx: string) => `
  SELECT o.id, o.order_no AS "orderNo", o.order_date AS date, o.status,
         c.id AS "customerId", c.name AS "customerName", r.name AS "regionName",
         o.department, o.project,
         COUNT(oi.id) AS items,
         COALESCE(SUM(oi.quantity * oi.unit_price * ${fx}), 0) AS total
  FROM orders o
  JOIN customers c ON c.id = o.customer_id
  JOIN regions r ON r.id = o.region_id
  LEFT JOIN order_items oi ON oi.order_id = o.id`;

const roundOrder = (o: OrderSummary): OrderSummary => ({ ...o, items: Number(o.items), total: roundMoney(Number(o.total)) });

async function ordersWhere(db: DbClient, where: string, params: SqlParam[], limit = ORDER_LIMIT, exactNo?: string): Promise<OrderSummary[]> {
  // Tam numara eşleşmesi en üstte, sonra en yeni işlemler
  const rows = await db.query<OrderSummary>(
    `${ORDER_SELECT(fxFactor('o.order_date'))} WHERE ${where} GROUP BY o.id
     ORDER BY (UPPER(o.order_no) = UPPER(?) OR o.id = ?) DESC, o.order_date DESC, o.id DESC LIMIT ${limit}`,
    [...params, exactNo ?? null, exactNo && /^\d+$/.test(exactNo) ? Number(exactNo) : -1],
  );
  return rows.map(roundOrder);
}

export async function search(db: DbClient, query: string): Promise<SearchResults> {
  const q = query.trim().slice(0, MAX_QUERY);
  const empty: SearchResults = { query: q, customers: [], orders: [], products: [], categories: [], regions: [], groups: [], expenses: [], total: 0 };
  const compact = q.replace(/^#/, '').trim();
  const numeric = /^\d+$/.test(compact);
  if (normalizeText(q).length < MIN_QUERY && !numeric) return empty;
  const score = matcher(q);
  const fxOrder = fxFactor('o.order_date');
  const delivered = `o.status = 'delivered'`;

  // Ad listeleri küçüktür: uygulamada süzülür (SQLite LIKE Türkçe harfleri büyük/küçük eşleştiremez)
  const [customerRows, productRows, regionRows, groupRows, expenseRows] = await Promise.all([
    db.query<{ id: number; name: string; customerType: string; regionName: string }>(
      `SELECT c.id, c.name, c.customer_type AS "customerType", r.name AS "regionName" FROM customers c JOIN regions r ON r.id = c.region_id`,
    ),
    db.query<{ id: number; sku: string; name: string; category: string }>(`SELECT id, sku, name, category FROM products`),
    db.query<{ id: number; name: string }>(`SELECT id, name FROM regions`),
    db.query<{ kind: 'department' | 'project'; name: string }>(
      `SELECT DISTINCT 'department' AS kind, department AS name FROM orders WHERE department IS NOT NULL AND department <> ''
       UNION SELECT DISTINCT 'department', department FROM expenses WHERE department IS NOT NULL AND department <> ''
       UNION SELECT DISTINCT 'project', project FROM orders WHERE project IS NOT NULL AND project <> ''
       UNION SELECT DISTINCT 'project', project FROM expenses WHERE project IS NOT NULL AND project <> ''`,
    ),
    db.query<{ id: number; date: string; category: string; description: string | null; project: string | null; amount: number }>(
      `SELECT id, expense_date AS date, category, description, project, amount * ${fxFactor('expense_date')} AS amount
       FROM expenses ORDER BY expense_date DESC, id DESC LIMIT 5000`,
    ),
  ]);

  // "#12" yalnızca işlem numarası araması
  const onlyOrders = q.startsWith('#');
  if (onlyOrders) {
    customerRows.length = productRows.length = regionRows.length = groupRows.length = expenseRows.length = 0;
  }
  const customers = best(customerRows, (c) => score(c.name));
  const products = best(productRows, (p) => Math.max(score(p.name), score(p.sku) ? 3 : 0));
  const categoryNames = [...new Set(productRows.map((p) => p.category))];
  const categories = best(categoryNames, (name) => score(name), 4);
  const regions = best(regionRows, (r) => score(r.name), 4);
  const groups = best(groupRows, (g) => score(g.name), 6);
  const expenseGroups = new Map<string, SearchResults['expenses'][number]>();
  for (const e of expenseRows) {
    if (!Math.max(score(e.description), score(e.category), score(e.project))) continue;
    const key = `${e.category}|${e.description ?? ''}|${e.project ?? ''}`;
    const group = expenseGroups.get(key);
    if (group) {
      group.count += 1;
      group.total += Number(e.amount);
    } else {
      expenseGroups.set(key, { description: e.description, category: e.category, project: e.project, count: 1, total: Number(e.amount), lastDate: e.date });
    }
  }
  const expenses = [...expenseGroups.values()].slice(0, LIMIT);

  // İşlemler: sipariş numarası (veya Clario numarası "#12") eşleşenler; tek müşteri bulunduysa son işlemleri
  const orderConditions: string[] = [];
  const orderParams: SqlParam[] = [];
  if (compact.length >= MIN_QUERY || numeric) {
    orderConditions.push(`o.order_no LIKE ? ESCAPE '\\'`);
    orderParams.push(`%${compact.replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`);
  }
  if (numeric) {
    orderConditions.push('o.id = ?');
    orderParams.push(Number(compact));
  }
  let orders = orderConditions.length > 0 ? await ordersWhere(db, `(${orderConditions.join(' OR ')})`, orderParams, ORDER_LIMIT, compact) : [];
  if (orders.length === 0 && customers.length === 1) orders = await ordersWhere(db, 'o.customer_id = ?', [customers[0]!.id], 5);

  // Bulunanların özet rakamları (yalnızca teslim edilen satışlar)
  const customerStats = customers.length
    ? await db.query<{ id: number; orders: number; revenue: number; lastOrderDate: string | null }>(
        `SELECT c.id,
                (SELECT COUNT(*) FROM orders o WHERE o.customer_id = c.id AND ${delivered}) AS orders,
                (SELECT COALESCE(SUM(oi.quantity * oi.unit_price * ${fxOrder}), 0) FROM orders o JOIN order_items oi ON oi.order_id = o.id
                  WHERE o.customer_id = c.id AND ${delivered}) AS revenue,
                (SELECT MAX(o.order_date) FROM orders o WHERE o.customer_id = c.id) AS "lastOrderDate"
         FROM customers c WHERE c.id IN (${placeholders(customers.length)})`,
        customers.map((c) => c.id),
      )
    : [];
  const productStats = products.length
    ? await db.query<{ id: number; quantity: number; revenue: number }>(
        `SELECT oi.product_id AS id, SUM(oi.quantity) AS quantity, SUM(oi.quantity * oi.unit_price * ${fxOrder}) AS revenue
         FROM order_items oi JOIN orders o ON o.id = oi.order_id
         WHERE ${delivered} AND oi.product_id IN (${placeholders(products.length)}) GROUP BY oi.product_id`,
        products.map((p) => p.id),
      )
    : [];
  const sumBy = async (where: string, params: SqlParam[]) =>
    roundMoney(
      Number(
        (
          await db.queryOne<{ total: number }>(
            `SELECT COALESCE(SUM(oi.quantity * oi.unit_price * ${fxOrder}), 0) AS total
             FROM orders o JOIN order_items oi ON oi.order_id = o.id JOIN products p ON p.id = oi.product_id WHERE ${delivered} AND ${where}`,
            params,
          )
        )?.total ?? 0,
      ),
    );

  const statOf = <T extends { id: number }>(rows: T[], id: number) => rows.find((r) => r.id === id);
  const result: SearchResults = {
    query: q,
    customers: customers.map((c) => {
      const stat = statOf(customerStats, c.id);
      return { ...c, orders: Number(stat?.orders ?? 0), revenue: roundMoney(Number(stat?.revenue ?? 0)), lastOrderDate: stat?.lastOrderDate ?? null };
    }),
    orders,
    products: products.map((p) => {
      const stat = statOf(productStats, p.id);
      return { ...p, quantity: Number(stat?.quantity ?? 0), revenue: roundMoney(Number(stat?.revenue ?? 0)) };
    }),
    categories: await Promise.all(
      categories.map(async (name) => ({ name, products: productRows.filter((p) => p.category === name).length, revenue: await sumBy('p.category = ?', [name]) })),
    ),
    regions: await Promise.all(regions.map(async (r) => ({ ...r, revenue: await sumBy('o.region_id = ?', [r.id]) }))),
    groups: await Promise.all(groups.map(async (g) => ({ ...g, revenue: await sumBy(`o.${g.kind} = ?`, [g.name]) }))),
    expenses: expenses.map((e) => ({ ...e, total: roundMoney(e.total) })),
    total: 0,
  };
  result.total =
    result.customers.length + result.orders.length + result.products.length + result.categories.length + result.regions.length + result.groups.length + result.expenses.length;
  return result;
}

/** Tek işlemin (siparişin) ayrıntısı: kalemler, müşteri, bölge, satış temsilcisi */
export async function getOrderDetail(db: DbClient, id: number): Promise<OrderDetail | null> {
  const [summary] = await ordersWhere(db, 'o.id = ?', [id], 1);
  if (!summary) return null;
  const fx = fxFactor('o.order_date');
  const [rep, lines] = await Promise.all([
    db.queryOne<{ name: string | null }>(
      `SELECT e.full_name AS name FROM orders o LEFT JOIN employees e ON e.id = COALESCE(o.sales_rep_id, (SELECT sales_rep_id FROM customers WHERE id = o.customer_id)) WHERE o.id = ?`,
      [id],
    ),
    db.query<OrderDetail['lines'][number]>(
      `SELECT p.id AS "productId", p.sku, p.name, p.category, oi.quantity,
              oi.unit_price * ${fx} AS "unitPrice", oi.quantity * oi.unit_price * ${fx} AS total
       FROM order_items oi JOIN orders o ON o.id = oi.order_id JOIN products p ON p.id = oi.product_id
       WHERE oi.order_id = ? ORDER BY oi.id`,
      [id],
    ),
  ]);
  return {
    ...summary,
    salesRepName: rep?.name ?? null,
    lines: lines.map((l) => ({ ...l, quantity: Number(l.quantity), unitPrice: roundMoney(Number(l.unitPrice)), total: roundMoney(Number(l.total)) })),
  };
}
