import type { DbClient } from './types.js';

/**
 * Şema, SQLite ve Postgres'te aynı şekilde çalışacak tipler ile yazılmıştır
 * (INTEGER, TEXT, NUMERIC). Kimlikler seed tarafından verilir; AUTOINCREMENT/SERIAL
 * gibi motora özgü yapılar kullanılmaz. Tarihler ISO 8601 ('YYYY-MM-DD') metnidir.
 */
const CREATE_SCHEMA = `
CREATE TABLE IF NOT EXISTS regions (
  id   INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS products (
  id         INTEGER PRIMARY KEY,
  sku        TEXT NOT NULL UNIQUE,
  name       TEXT NOT NULL,
  category   TEXT NOT NULL,
  unit_cost  NUMERIC(12, 2) NOT NULL,
  list_price NUMERIC(12, 2) NOT NULL
);

CREATE TABLE IF NOT EXISTS employees (
  id             INTEGER PRIMARY KEY,
  full_name      TEXT NOT NULL,
  role           TEXT NOT NULL,
  region_id      INTEGER REFERENCES regions(id),
  monthly_salary NUMERIC(12, 2) NOT NULL,
  hire_date      TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS customers (
  id            INTEGER PRIMARY KEY,
  name          TEXT NOT NULL,
  customer_type TEXT NOT NULL CHECK (customer_type IN ('Bayi', 'Mağaza')),
  region_id     INTEGER NOT NULL REFERENCES regions(id),
  sales_rep_id  INTEGER REFERENCES employees(id),
  created_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS orders (
  id           INTEGER PRIMARY KEY,
  customer_id  INTEGER NOT NULL REFERENCES customers(id),
  region_id    INTEGER NOT NULL REFERENCES regions(id),
  sales_rep_id INTEGER REFERENCES employees(id),
  order_date   TEXT NOT NULL,
  status       TEXT NOT NULL CHECK (status IN ('delivered', 'cancelled')),
  -- Kullanıcının sipariş numarası (Excel içe aktarımında aynı siparişi tanımak için)
  order_no     TEXT,
  -- Opsiyonel: satışın ait olduğu departman ve proje/iş
  department   TEXT,
  project      TEXT
);

CREATE TABLE IF NOT EXISTS order_items (
  id         INTEGER PRIMARY KEY,
  order_id   INTEGER NOT NULL REFERENCES orders(id),
  product_id INTEGER NOT NULL REFERENCES products(id),
  quantity   INTEGER NOT NULL CHECK (quantity > 0),
  unit_price NUMERIC(12, 2) NOT NULL
);

CREATE TABLE IF NOT EXISTS inventory (
  product_id INTEGER NOT NULL REFERENCES products(id),
  region_id  INTEGER NOT NULL REFERENCES regions(id),
  quantity   INTEGER NOT NULL CHECK (quantity >= 0),
  updated_at TEXT NOT NULL,
  PRIMARY KEY (product_id, region_id)
);

CREATE TABLE IF NOT EXISTS expenses (
  id           INTEGER PRIMARY KEY,
  expense_date TEXT NOT NULL,
  category     TEXT NOT NULL,
  amount       NUMERIC(12, 2) NOT NULL,
  region_id    INTEGER REFERENCES regions(id),
  description  TEXT,
  -- Opsiyonel: giderin ait olduğu departman ve proje/iş
  department   TEXT,
  project      TEXT
);

-- Uygulama ayarları (ör. verilerin girildiği para birimi)
CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- Günlük döviz kurları: 1 EUR karşılığı birim (ECB referans kurları). Hafta sonu ve tatiller
-- bir önceki iş gününün kuruyla doldurulur; böylece her takvim günü doğrudan eşleşir.
CREATE TABLE IF NOT EXISTS fx_rates (
  currency  TEXT NOT NULL,
  rate_date TEXT NOT NULL,
  per_eur   NUMERIC(18, 6) NOT NULL,
  PRIMARY KEY (currency, rate_date)
);

-- Tahsilatlar (cari hesap): müşteriden alınan ödemeler. Faturalara en eskiden başlayarak mahsup edilir.
CREATE TABLE IF NOT EXISTS payments (
  id           INTEGER PRIMARY KEY,
  customer_id  INTEGER NOT NULL REFERENCES customers(id),
  payment_date TEXT NOT NULL,
  amount       NUMERIC(14, 2) NOT NULL CHECK (amount > 0),
  method       TEXT,
  reference    TEXT,
  description  TEXT
);

CREATE INDEX IF NOT EXISTS idx_orders_date ON orders(order_date);
CREATE INDEX IF NOT EXISTS idx_payments_customer ON payments(customer_id, payment_date);
CREATE INDEX IF NOT EXISTS idx_orders_customer_date ON orders(customer_id, order_date);
CREATE INDEX IF NOT EXISTS idx_order_items_order ON order_items(order_id);
CREATE INDEX IF NOT EXISTS idx_order_items_product ON order_items(product_id);
CREATE INDEX IF NOT EXISTS idx_expenses_date ON expenses(expense_date);
`;

// Kurlar ve ayarlar veri sıfırlamada korunur (kullanıcı verisi değildir).
const DROP_SCHEMA = `
DROP TABLE IF EXISTS payments;
DROP TABLE IF EXISTS expenses;
DROP TABLE IF EXISTS inventory;
DROP TABLE IF EXISTS order_items;
DROP TABLE IF EXISTS orders;
DROP TABLE IF EXISTS customers;
DROP TABLE IF EXISTS employees;
DROP TABLE IF EXISTS products;
DROP TABLE IF EXISTS regions;
`;

async function addColumnIfMissing(db: DbClient, table: string, column: string, type = 'TEXT'): Promise<void> {
  try {
    await db.query(`SELECT ${column} FROM ${table} LIMIT 0`);
  } catch {
    await db.executeScript(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
  }
}

/** Şemanın sonraki sürümlerde eklenen kısımları; eski veritabanları açılışta güncellenir. */
async function migrate(db: DbClient): Promise<void> {
  await addColumnIfMissing(db, 'orders', 'order_no');
  for (const table of ['orders', 'expenses']) {
    await addColumnIfMissing(db, table, 'department');
    await addColumnIfMissing(db, table, 'project');
  }
  // Cari hesap ve alacak takibi (e-Fatura / ERP aktarımı ile gelir; elle de girilebilir)
  await addColumnIfMissing(db, 'customers', 'tax_id');
  await addColumnIfMissing(db, 'customers', 'payment_term_days', 'INTEGER');
  await addColumnIfMissing(db, 'customers', 'credit_limit', 'NUMERIC(14, 2)');
  await addColumnIfMissing(db, 'orders', 'due_date');
  await addColumnIfMissing(db, 'orders', 'invoice_total', 'NUMERIC(14, 2)');
  await addColumnIfMissing(db, 'expenses', 'supplier');
  await addColumnIfMissing(db, 'expenses', 'due_date');
  await addColumnIfMissing(db, 'expenses', 'invoice_no');
  await addColumnIfMissing(db, 'expenses', 'paid_date');
  await addColumnIfMissing(db, 'expenses', 'invoice_total', 'NUMERIC(14, 2)');
  // Numarasız eski siparişlere kalıcı numara: Excel'e aktarılıp geri yüklendiğinde eşleşsin
  await db.execute("UPDATE orders SET order_no = 'S-' || id WHERE order_no IS NULL");
  await db.executeScript(
    'CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_order_no ON orders(order_no) WHERE order_no IS NOT NULL',
  );
  // Harici yapay zekâ bağlantısı kaldırıldı: daha önce kaydedilmiş API anahtarları silinir
  await db.execute("DELETE FROM settings WHERE key IN ('ai_provider', 'ai_model', 'ai_api_key')");
}

export async function ensureSchema(db: DbClient): Promise<void> {
  await db.executeScript(CREATE_SCHEMA);
  await migrate(db);
}

export async function resetSchema(db: DbClient): Promise<void> {
  await db.executeScript(DROP_SCHEMA);
  await ensureSchema(db);
}
