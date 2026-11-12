/**
 * Uygulama içinden veri girişi: bölge, ürün, müşteri, çalışan, sipariş, stok ve gider kayıtları.
 * Her fonksiyon girdiyi doğrular ve anlamlı Türkçe hatalar fırlatır:
 *  - FieldError → 400 (geçersiz alan)
 *  - HttpError(404) → kayıt bulunamadı
 *  - HttpError(409) → çakışma (aynı adla kayıt var, kayıt kullanımda olduğu için silinemez…)
 * SQL taşınabilir yazılmıştır (bkz. db/types.ts).
 */
import type { DbClient } from '../db/types.js';
import { HttpError } from '../http/errors.js';
import { todayIso } from '../utils/dates.js';
import {
  CUSTOMER_TYPES,
  FieldError,
  matchKey,
  oneOf,
  optionalDate,
  optionalNumber,
  optionalText,
  ORDER_STATUSES,
  requiredDate,
  requiredNumber,
  requiredText,
} from './validation.js';

type Input = Record<string, unknown>;

// ── Ortak yardımcılar ────────────────────────────────────────────────────────

export async function nextId(db: DbClient, table: string): Promise<number> {
  const row = await db.queryOne<{ id: number }>(`SELECT COALESCE(MAX(id), 0) + 1 AS id FROM ${table}`);
  return row!.id;
}

async function count(db: DbClient, sql: string, params: (string | number)[]): Promise<number> {
  const row = await db.queryOne<{ n: number }>(sql, params);
  return Number(row?.n ?? 0);
}

async function requireExists(db: DbClient, table: string, id: number, label: string): Promise<void> {
  if ((await count(db, `SELECT COUNT(*) AS n FROM ${table} WHERE id = ?`, [id])) === 0) {
    throw new HttpError(404, `${label} bulunamadı (id: ${id}).`);
  }
}

function idOf(value: unknown, label: string, required: true): number;
function idOf(value: unknown, label: string, required: false): number | null;
function idOf(value: unknown, label: string, required: boolean): number | null {
  if (value === null || value === undefined || value === '') {
    if (required) throw new FieldError(label, `${label} seçilmelidir.`);
    return null;
  }
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) throw new FieldError(label, `${label} geçersiz.`);
  return id;
}

/** Aynı adla (büyük/küçük harf ve Türkçe karakter farkı gözetmeden) başka kayıt var mı? */
async function assertUniqueName(
  db: DbClient,
  table: string,
  column: string,
  value: string,
  label: string,
  exceptId?: number,
): Promise<void> {
  const rows = await db.query<{ id: number; value: string }>(`SELECT id, ${column} AS value FROM ${table}`);
  const clash = rows.find((r) => r.id !== exceptId && matchKey(r.value) === matchKey(value));
  if (clash) throw new HttpError(409, `"${value}" adında bir ${label} zaten var.`);
}

async function assertUnused(db: DbClient, checks: [string, string][], id: number, label: string): Promise<void> {
  for (const [sql, usage] of checks) {
    const n = await count(db, sql, [id]);
    if (n > 0) throw new HttpError(409, `Bu ${label} ${n} ${usage} kullanıldığı için silinemez.`);
  }
}

// ── Bölgeler ─────────────────────────────────────────────────────────────────

export interface RegionRecord {
  id: number;
  name: string;
  customerCount: number;
}

export function listRegions(db: DbClient): Promise<RegionRecord[]> {
  return db.query<RegionRecord>(`
    SELECT r.id, r.name, (SELECT COUNT(*) FROM customers c WHERE c.region_id = r.id) AS "customerCount"
    FROM regions r ORDER BY r.name`);
}

export async function createRegion(db: DbClient, input: Input): Promise<RegionRecord> {
  const name = requiredText(input.name, 'Bölge adı', 80);
  await assertUniqueName(db, 'regions', 'name', name, 'bölge');
  const id = await nextId(db, 'regions');
  await db.execute('INSERT INTO regions (id, name) VALUES (?, ?)', [id, name]);
  return { id, name, customerCount: 0 };
}

export async function updateRegion(db: DbClient, id: number, input: Input): Promise<void> {
  await requireExists(db, 'regions', id, 'Bölge');
  const name = requiredText(input.name, 'Bölge adı', 80);
  await assertUniqueName(db, 'regions', 'name', name, 'bölge', id);
  await db.execute('UPDATE regions SET name = ? WHERE id = ?', [name, id]);
}

export async function deleteRegion(db: DbClient, id: number): Promise<void> {
  await requireExists(db, 'regions', id, 'Bölge');
  await assertUnused(
    db,
    [
      ['SELECT COUNT(*) AS n FROM customers WHERE region_id = ?', 'müşteride'],
      ['SELECT COUNT(*) AS n FROM orders WHERE region_id = ?', 'siparişte'],
      ['SELECT COUNT(*) AS n FROM employees WHERE region_id = ?', 'çalışanda'],
      ['SELECT COUNT(*) AS n FROM expenses WHERE region_id = ?', 'gider kaydında'],
    ],
    id,
    'bölge',
  );
  await db.transaction(async (tx) => {
    await tx.execute('DELETE FROM inventory WHERE region_id = ?', [id]);
    await tx.execute('DELETE FROM regions WHERE id = ?', [id]);
  });
}

// ── Ürünler ──────────────────────────────────────────────────────────────────

export interface ProductRecord {
  id: number;
  sku: string;
  name: string;
  category: string;
  unitCost: number;
  listPrice: number;
  totalStock: number;
}

function readProduct(input: Input) {
  return {
    sku: requiredText(input.sku, 'Ürün kodu (SKU)', 40),
    name: requiredText(input.name, 'Ürün adı', 120),
    category: requiredText(input.category, 'Kategori', 60),
    unitCost: requiredNumber(input.unitCost, 'Birim maliyet', { min: 0 }),
    listPrice: requiredNumber(input.listPrice, 'Liste fiyatı', { min: 0 }),
  };
}

export function listProducts(db: DbClient): Promise<ProductRecord[]> {
  return db.query<ProductRecord>(`
    SELECT p.id, p.sku, p.name, p.category, p.unit_cost AS "unitCost", p.list_price AS "listPrice",
           COALESCE((SELECT SUM(i.quantity) FROM inventory i WHERE i.product_id = p.id), 0) AS "totalStock"
    FROM products p ORDER BY p.name`);
}

export async function createProduct(db: DbClient, input: Input): Promise<{ id: number }> {
  const p = readProduct(input);
  await assertUniqueName(db, 'products', 'sku', p.sku, 'ürün kodu');
  const id = await nextId(db, 'products');
  await db.execute(
    'INSERT INTO products (id, sku, name, category, unit_cost, list_price) VALUES (?, ?, ?, ?, ?, ?)',
    [id, p.sku, p.name, p.category, p.unitCost, p.listPrice],
  );
  return { id };
}

export async function updateProduct(db: DbClient, id: number, input: Input): Promise<void> {
  await requireExists(db, 'products', id, 'Ürün');
  const p = readProduct(input);
  await assertUniqueName(db, 'products', 'sku', p.sku, 'ürün kodu', id);
  await db.execute(
    'UPDATE products SET sku = ?, name = ?, category = ?, unit_cost = ?, list_price = ? WHERE id = ?',
    [p.sku, p.name, p.category, p.unitCost, p.listPrice, id],
  );
}

export async function deleteProduct(db: DbClient, id: number): Promise<void> {
  await requireExists(db, 'products', id, 'Ürün');
  await assertUnused(db, [['SELECT COUNT(*) AS n FROM order_items WHERE product_id = ?', 'satış kaleminde']], id, 'ürün');
  await db.transaction(async (tx) => {
    await tx.execute('DELETE FROM inventory WHERE product_id = ?', [id]);
    await tx.execute('DELETE FROM products WHERE id = ?', [id]);
  });
}

// ── Çalışanlar ───────────────────────────────────────────────────────────────

export interface EmployeeRecord {
  id: number;
  fullName: string;
  role: string;
  regionId: number | null;
  regionName: string | null;
  monthlySalary: number;
  hireDate: string;
}

async function readEmployee(db: DbClient, input: Input) {
  const regionId = idOf(input.regionId, 'Bölge', false);
  if (regionId !== null) await requireExists(db, 'regions', regionId, 'Bölge');
  return {
    fullName: requiredText(input.fullName, 'Ad soyad', 100),
    role: requiredText(input.role, 'Görev', 80),
    regionId,
    monthlySalary: requiredNumber(input.monthlySalary, 'Aylık maaş', { min: 0 }),
    hireDate: optionalDate(input.hireDate, 'İşe başlama tarihi') ?? todayIso(),
  };
}

export function listEmployees(db: DbClient): Promise<EmployeeRecord[]> {
  return db.query<EmployeeRecord>(`
    SELECT e.id, e.full_name AS "fullName", e.role, e.region_id AS "regionId", r.name AS "regionName",
           e.monthly_salary AS "monthlySalary", e.hire_date AS "hireDate"
    FROM employees e LEFT JOIN regions r ON r.id = e.region_id
    ORDER BY e.full_name`);
}

export async function createEmployee(db: DbClient, input: Input): Promise<{ id: number }> {
  const e = await readEmployee(db, input);
  await assertUniqueName(db, 'employees', 'full_name', e.fullName, 'çalışan');
  const id = await nextId(db, 'employees');
  await db.execute(
    'INSERT INTO employees (id, full_name, role, region_id, monthly_salary, hire_date) VALUES (?, ?, ?, ?, ?, ?)',
    [id, e.fullName, e.role, e.regionId, e.monthlySalary, e.hireDate],
  );
  return { id };
}

export async function updateEmployee(db: DbClient, id: number, input: Input): Promise<void> {
  await requireExists(db, 'employees', id, 'Çalışan');
  const e = await readEmployee(db, input);
  await assertUniqueName(db, 'employees', 'full_name', e.fullName, 'çalışan', id);
  await db.execute(
    'UPDATE employees SET full_name = ?, role = ?, region_id = ?, monthly_salary = ?, hire_date = ? WHERE id = ?',
    [e.fullName, e.role, e.regionId, e.monthlySalary, e.hireDate, id],
  );
}

export async function deleteEmployee(db: DbClient, id: number): Promise<void> {
  await requireExists(db, 'employees', id, 'Çalışan');
  // Satış temsilcisi silinince müşteri ve sipariş kayıtları korunur, yalnızca temsilci bağlantısı kalkar.
  await db.transaction(async (tx) => {
    await tx.execute('UPDATE customers SET sales_rep_id = NULL WHERE sales_rep_id = ?', [id]);
    await tx.execute('UPDATE orders SET sales_rep_id = NULL WHERE sales_rep_id = ?', [id]);
    await tx.execute('DELETE FROM employees WHERE id = ?', [id]);
  });
}

// ── Müşteriler ───────────────────────────────────────────────────────────────

export interface CustomerRecord {
  id: number;
  name: string;
  customerType: 'Bayi' | 'Mağaza';
  regionId: number;
  regionName: string;
  salesRepId: number | null;
  salesRepName: string | null;
  orderCount: number;
  lastOrderDate: string | null;
  taxId: string | null;
  paymentTermDays: number | null;
  creditLimit: number | null;
}

/** VKN (10 hane) veya TCKN (11 hane) */
function taxIdInput(value: unknown): string | null {
  const text = optionalText(value, 'Vergi no', 20);
  if (!text) return null;
  const digits = text.replace(/\D/g, '');
  if (digits.length !== 10 && digits.length !== 11) throw new FieldError('Vergi no', 'Vergi no 10 haneli VKN veya 11 haneli TCKN olmalıdır.');
  return digits;
}

async function readCustomer(db: DbClient, input: Input) {
  const regionId = idOf(input.regionId, 'Bölge', true);
  await requireExists(db, 'regions', regionId, 'Bölge');
  const salesRepId = idOf(input.salesRepId, 'Satış temsilcisi', false);
  if (salesRepId !== null) await requireExists(db, 'employees', salesRepId, 'Satış temsilcisi');
  return {
    name: requiredText(input.name, 'Müşteri adı', 120),
    customerType: oneOf(input.customerType, 'Müşteri tipi', CUSTOMER_TYPES),
    regionId,
    salesRepId,
    taxId: taxIdInput(input.taxId),
    paymentTermDays: optionalNumber(input.paymentTermDays, 'Vade (gün)', { min: 0, integer: true }),
    creditLimit: optionalNumber(input.creditLimit, 'Kredi limiti', { min: 0 }),
  };
}

export function listCustomers(db: DbClient): Promise<CustomerRecord[]> {
  return db.query<CustomerRecord>(`
    SELECT c.id, c.name, c.customer_type AS "customerType", c.region_id AS "regionId", r.name AS "regionName",
           c.sales_rep_id AS "salesRepId", e.full_name AS "salesRepName",
           (SELECT COUNT(*) FROM orders o WHERE o.customer_id = c.id) AS "orderCount",
           (SELECT MAX(o.order_date) FROM orders o WHERE o.customer_id = c.id) AS "lastOrderDate",
           c.tax_id AS "taxId", c.payment_term_days AS "paymentTermDays", c.credit_limit AS "creditLimit"
    FROM customers c
    JOIN regions r ON r.id = c.region_id
    LEFT JOIN employees e ON e.id = c.sales_rep_id
    ORDER BY c.name`);
}

export async function createCustomer(db: DbClient, input: Input): Promise<{ id: number }> {
  const c = await readCustomer(db, input);
  await assertUniqueName(db, 'customers', 'name', c.name, 'müşteri');
  const id = await nextId(db, 'customers');
  await db.execute(
    'INSERT INTO customers (id, name, customer_type, region_id, sales_rep_id, created_at, tax_id, payment_term_days, credit_limit) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [id, c.name, c.customerType, c.regionId, c.salesRepId, todayIso(), c.taxId, c.paymentTermDays, c.creditLimit],
  );
  return { id };
}

export async function updateCustomer(db: DbClient, id: number, input: Input): Promise<void> {
  await requireExists(db, 'customers', id, 'Müşteri');
  const c = await readCustomer(db, input);
  await assertUniqueName(db, 'customers', 'name', c.name, 'müşteri', id);
  await db.execute(
    'UPDATE customers SET name = ?, customer_type = ?, region_id = ?, sales_rep_id = ?, tax_id = ?, payment_term_days = ?, credit_limit = ? WHERE id = ?',
    [c.name, c.customerType, c.regionId, c.salesRepId, c.taxId, c.paymentTermDays, c.creditLimit, id],
  );
}

export async function deleteCustomer(db: DbClient, id: number): Promise<void> {
  await requireExists(db, 'customers', id, 'Müşteri');
  await assertUnused(
    db,
    [
      ['SELECT COUNT(*) AS n FROM orders WHERE customer_id = ?', 'siparişte'],
      ['SELECT COUNT(*) AS n FROM payments WHERE customer_id = ?', 'tahsilatta'],
    ],
    id,
    'müşteri',
  );
  await db.execute('DELETE FROM customers WHERE id = ?', [id]);
}

// ── Siparişler (satışlar) ────────────────────────────────────────────────────

export interface OrderRecord {
  id: number;
  orderNo: string | null;
  orderDate: string;
  status: 'delivered' | 'cancelled';
  customerId: number;
  customerName: string;
  regionName: string;
  department: string | null;
  project: string | null;
  itemCount: number;
  totalAmount: number;
}

export interface OrderItemRecord {
  productId: number;
  productName: string;
  sku: string;
  quantity: number;
  unitPrice: number;
}

export async function listOrders(
  db: DbClient,
  options: { limit?: number; offset?: number } = {},
): Promise<{ total: number; items: OrderRecord[] }> {
  const limit = Math.min(Math.max(Number(options.limit) || 50, 1), 500);
  const offset = Math.max(Number(options.offset) || 0, 0);
  const total = await count(db, 'SELECT COUNT(*) AS n FROM orders', []);
  const items = await db.query<OrderRecord>(
    `
    SELECT o.id, o.order_no AS "orderNo", o.order_date AS "orderDate", o.status,
           o.customer_id AS "customerId", c.name AS "customerName", r.name AS "regionName",
           o.department, o.project,
           COUNT(oi.id) AS "itemCount", COALESCE(SUM(oi.quantity * oi.unit_price), 0) AS "totalAmount"
    FROM orders o
    JOIN customers c ON c.id = o.customer_id
    JOIN regions r ON r.id = o.region_id
    LEFT JOIN order_items oi ON oi.order_id = o.id
    GROUP BY o.id, o.order_no, o.order_date, o.status, o.customer_id, c.name, r.name, o.department, o.project
    ORDER BY o.order_date DESC, o.id DESC
    LIMIT ? OFFSET ?`,
    [limit, offset],
  );
  return { total, items };
}

export async function getOrderItems(db: DbClient, orderId: number): Promise<OrderItemRecord[]> {
  await requireExists(db, 'orders', orderId, 'Sipariş');
  return db.query<OrderItemRecord>(
    `
    SELECT oi.product_id AS "productId", p.name AS "productName", p.sku, oi.quantity, oi.unit_price AS "unitPrice"
    FROM order_items oi JOIN products p ON p.id = oi.product_id
    WHERE oi.order_id = ? ORDER BY oi.id`,
    [orderId],
  );
}

export async function createOrder(db: DbClient, input: Input): Promise<{ id: number; orderNo: string }> {
  const customerId = idOf(input.customerId, 'Müşteri', true);
  const customer = await db.queryOne<{ regionId: number; salesRepId: number | null }>(
    'SELECT region_id AS "regionId", sales_rep_id AS "salesRepId" FROM customers WHERE id = ?',
    [customerId],
  );
  if (!customer) throw new HttpError(404, `Müşteri bulunamadı (id: ${customerId}).`);

  const orderDate = requiredDate(input.orderDate, 'Sipariş tarihi');
  const status = oneOf(input.status, 'Durum', ORDER_STATUSES, 'delivered');
  const department = optionalText(input.department, 'Departman', 80);
  const project = optionalText(input.project, 'Proje', 80);
  const dueDate = optionalDate(input.dueDate, 'Vade tarihi');
  let orderNo = optionalText(input.orderNo, 'Sipariş no', 40);
  if (orderNo && (await count(db, 'SELECT COUNT(*) AS n FROM orders WHERE order_no = ?', [orderNo])) > 0) {
    throw new HttpError(409, `"${orderNo}" numaralı bir sipariş zaten var.`);
  }

  const rawItems = Array.isArray(input.items) ? input.items : [];
  if (rawItems.length === 0) throw new FieldError('Ürünler', 'Siparişte en az bir ürün olmalıdır.');
  const items: { productId: number; quantity: number; unitPrice: number }[] = [];
  for (const [index, raw] of rawItems.entries()) {
    const row = (raw ?? {}) as Input;
    const label = `${index + 1}. satır`;
    const productId = idOf(row.productId, `${label}: ürün`, true);
    const product = await db.queryOne<{ listPrice: number }>('SELECT list_price AS "listPrice" FROM products WHERE id = ?', [
      productId,
    ]);
    if (!product) throw new HttpError(404, `${label}: ürün bulunamadı.`);
    items.push({
      productId,
      quantity: requiredNumber(row.quantity, `${label}: adet`, { min: 1, integer: true }),
      unitPrice: optionalNumber(row.unitPrice, `${label}: birim fiyat`, { min: 0 }) ?? product.listPrice,
    });
  }

  return db.transaction(async (tx) => {
    const id = await nextId(tx, 'orders');
    orderNo ??= `S-${id}`;
    await tx.execute(
      'INSERT INTO orders (id, customer_id, region_id, sales_rep_id, order_date, status, order_no, department, project, due_date) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [id, customerId, customer.regionId, customer.salesRepId, orderDate, status, orderNo, department, project, dueDate],
    );
    let itemId = await nextId(tx, 'order_items');
    for (const item of items) {
      await tx.execute('INSERT INTO order_items (id, order_id, product_id, quantity, unit_price) VALUES (?, ?, ?, ?, ?)', [
        itemId++,
        id,
        item.productId,
        item.quantity,
        item.unitPrice,
      ]);
    }
    return { id, orderNo };
  });
}

/** Siparişin durumunu, departmanını veya projesini günceller; yalnızca gönderilen alanlar değişir. */
export async function updateOrder(db: DbClient, id: number, input: Input): Promise<void> {
  await requireExists(db, 'orders', id, 'Sipariş');
  const updates: [string, string | null][] = [];
  if ('status' in input) updates.push(['status', oneOf(input.status, 'Durum', ORDER_STATUSES)]);
  if ('department' in input) updates.push(['department', optionalText(input.department, 'Departman', 80)]);
  if ('project' in input) updates.push(['project', optionalText(input.project, 'Proje', 80)]);
  if ('dueDate' in input) updates.push(['due_date', optionalDate(input.dueDate, 'Vade tarihi')]);
  if (updates.length === 0) throw new FieldError('Sipariş', 'Güncellenecek alan yok (durum, departman, proje veya vade).');
  await db.execute(`UPDATE orders SET ${updates.map(([column]) => `${column} = ?`).join(', ')} WHERE id = ?`, [
    ...updates.map(([, value]) => value),
    id,
  ]);
}

export async function deleteOrder(db: DbClient, id: number): Promise<void> {
  await requireExists(db, 'orders', id, 'Sipariş');
  await db.transaction(async (tx) => {
    await tx.execute('DELETE FROM order_items WHERE order_id = ?', [id]);
    await tx.execute('DELETE FROM orders WHERE id = ?', [id]);
  });
}

// ── Stok ─────────────────────────────────────────────────────────────────────

export interface InventoryRecord {
  productId: number;
  regionId: number;
  quantity: number;
}

export function listInventory(db: DbClient): Promise<InventoryRecord[]> {
  return db.query<InventoryRecord>(
    'SELECT product_id AS "productId", region_id AS "regionId", quantity FROM inventory',
  );
}

/** Birden fazla ürün × bölge stok değerini tek seferde yazar (0 da geçerli bir değerdir). */
export async function setInventory(db: DbClient, input: unknown): Promise<{ updated: number }> {
  const rows = Array.isArray(input) ? input : Array.isArray((input as Input)?.items) ? ((input as Input).items as unknown[]) : null;
  if (!rows) throw new FieldError('Stok', 'Stok listesi bekleniyor.');

  const parsed: InventoryRecord[] = [];
  for (const [index, raw] of rows.entries()) {
    const row = (raw ?? {}) as Input;
    const label = `${index + 1}. satır`;
    const productId = idOf(row.productId, `${label}: ürün`, true);
    const regionId = idOf(row.regionId, `${label}: bölge`, true);
    await requireExists(db, 'products', productId, `${label}: ürün`);
    await requireExists(db, 'regions', regionId, `${label}: bölge`);
    parsed.push({ productId, regionId, quantity: requiredNumber(row.quantity, `${label}: stok`, { min: 0, integer: true }) });
  }

  await db.transaction(async (tx) => {
    for (const row of parsed) await upsertInventory(tx, row.productId, row.regionId, row.quantity);
  });
  return { updated: parsed.length };
}

export async function upsertInventory(db: DbClient, productId: number, regionId: number, quantity: number): Promise<void> {
  const result = await db.execute('UPDATE inventory SET quantity = ?, updated_at = ? WHERE product_id = ? AND region_id = ?', [
    quantity,
    todayIso(),
    productId,
    regionId,
  ]);
  if (result.changes === 0) {
    await db.execute('INSERT INTO inventory (product_id, region_id, quantity, updated_at) VALUES (?, ?, ?, ?)', [
      productId,
      regionId,
      quantity,
      todayIso(),
    ]);
  }
}

// ── Giderler ─────────────────────────────────────────────────────────────────

export interface ExpenseRecord {
  id: number;
  expenseDate: string;
  category: string;
  amount: number;
  regionId: number | null;
  regionName: string | null;
  description: string | null;
  department: string | null;
  project: string | null;
  supplier: string | null;
  dueDate: string | null;
  paidDate: string | null;
  invoiceNo: string | null;
  invoiceTotal: number | null;
}

/** Kategori girilmeyen giderler bu kategoriye yazılır (ör. yalnızca departman/proje bazlı takip edenler). */
export const DEFAULT_EXPENSE_CATEGORY = 'Genel';

async function readExpense(db: DbClient, input: Input) {
  const regionId = idOf(input.regionId, 'Bölge', false);
  if (regionId !== null) await requireExists(db, 'regions', regionId, 'Bölge');
  return {
    expenseDate: requiredDate(input.expenseDate, 'Tarih'),
    category: optionalText(input.category, 'Kategori', 60) ?? DEFAULT_EXPENSE_CATEGORY,
    amount: requiredNumber(input.amount, 'Tutar', { min: 0 }),
    regionId,
    description: optionalText(input.description, 'Açıklama', 300),
    department: optionalText(input.department, 'Departman', 80),
    project: optionalText(input.project, 'Proje', 80),
    supplier: optionalText(input.supplier, 'Tedarikçi', 120),
    dueDate: optionalDate(input.dueDate, 'Vade tarihi'),
    paidDate: optionalDate(input.paidDate, 'Ödeme tarihi'),
    invoiceNo: optionalText(input.invoiceNo, 'Fatura no', 60),
    invoiceTotal: optionalNumber(input.invoiceTotal, 'Fatura toplamı', { min: 0 }),
  };
}

export function listExpenses(db: DbClient): Promise<ExpenseRecord[]> {
  return db.query<ExpenseRecord>(`
    SELECT x.id, x.expense_date AS "expenseDate", x.category, x.amount, x.region_id AS "regionId",
           r.name AS "regionName", x.description, x.department, x.project, x.supplier, x.due_date AS "dueDate",
           x.paid_date AS "paidDate", x.invoice_no AS "invoiceNo", x.invoice_total AS "invoiceTotal"
    FROM expenses x LEFT JOIN regions r ON r.id = x.region_id
    ORDER BY x.expense_date DESC, x.id DESC`);
}

export async function createExpense(db: DbClient, input: Input): Promise<{ id: number }> {
  const x = await readExpense(db, input);
  const id = await nextId(db, 'expenses');
  await db.execute(
    'INSERT INTO expenses (id, expense_date, category, amount, region_id, description, department, project, supplier, due_date, paid_date, invoice_no, invoice_total) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [id, x.expenseDate, x.category, x.amount, x.regionId, x.description, x.department, x.project, x.supplier, x.dueDate, x.paidDate, x.invoiceNo, x.invoiceTotal],
  );
  return { id };
}

export async function updateExpense(db: DbClient, id: number, input: Input): Promise<void> {
  await requireExists(db, 'expenses', id, 'Gider');
  const x = await readExpense(db, input);
  await db.execute(
    'UPDATE expenses SET expense_date = ?, category = ?, amount = ?, region_id = ?, description = ?, department = ?, project = ?, supplier = ?, due_date = ?, paid_date = ?, invoice_no = ?, invoice_total = ? WHERE id = ?',
    [x.expenseDate, x.category, x.amount, x.regionId, x.description, x.department, x.project, x.supplier, x.dueDate, x.paidDate, x.invoiceNo, x.invoiceTotal, id],
  );
}

export async function deleteExpense(db: DbClient, id: number): Promise<void> {
  await requireExists(db, 'expenses', id, 'Gider');
  await db.execute('DELETE FROM expenses WHERE id = ?', [id]);
}

/** Gideri (borcu) ödendi / ödenmedi olarak işaretler */
export async function setExpensePaid(db: DbClient, id: number, input: Input): Promise<void> {
  await requireExists(db, 'expenses', id, 'Gider');
  await db.execute('UPDATE expenses SET paid_date = ? WHERE id = ?', [optionalDate(input.paidDate, 'Ödeme tarihi'), id]);
}

// ── Tahsilatlar (cari hesap) ─────────────────────────────────────────────────

export interface PaymentRecord {
  id: number;
  customerId: number;
  customerName: string;
  paymentDate: string;
  amount: number;
  method: string | null;
  reference: string | null;
  description: string | null;
}

async function readPayment(db: DbClient, input: Input) {
  const customerId = idOf(input.customerId, 'Müşteri', true);
  await requireExists(db, 'customers', customerId, 'Müşteri');
  return {
    customerId,
    paymentDate: requiredDate(input.paymentDate, 'Tarih'),
    amount: requiredNumber(input.amount, 'Tutar', { min: 0.01 }),
    method: optionalText(input.method, 'Yöntem', 40),
    reference: optionalText(input.reference, 'Belge no', 60),
    description: optionalText(input.description, 'Açıklama', 300),
  };
}

export function listPayments(db: DbClient): Promise<PaymentRecord[]> {
  return db.query<PaymentRecord>(`
    SELECT p.id, p.customer_id AS "customerId", c.name AS "customerName", p.payment_date AS "paymentDate", p.amount,
           p.method, p.reference, p.description
    FROM payments p JOIN customers c ON c.id = p.customer_id
    ORDER BY p.payment_date DESC, p.id DESC`);
}

export async function createPayment(db: DbClient, input: Input): Promise<{ id: number }> {
  const p = await readPayment(db, input);
  const id = await nextId(db, 'payments');
  await db.execute(
    'INSERT INTO payments (id, customer_id, payment_date, amount, method, reference, description) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [id, p.customerId, p.paymentDate, p.amount, p.method, p.reference, p.description],
  );
  return { id };
}

export async function updatePayment(db: DbClient, id: number, input: Input): Promise<void> {
  await requireExists(db, 'payments', id, 'Tahsilat');
  const p = await readPayment(db, input);
  await db.execute(
    'UPDATE payments SET customer_id = ?, payment_date = ?, amount = ?, method = ?, reference = ?, description = ? WHERE id = ?',
    [p.customerId, p.paymentDate, p.amount, p.method, p.reference, p.description, id],
  );
}

export async function deletePayment(db: DbClient, id: number): Promise<void> {
  await requireExists(db, 'payments', id, 'Tahsilat');
  await db.execute('DELETE FROM payments WHERE id = ?', [id]);
}
