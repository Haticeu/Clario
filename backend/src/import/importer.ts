/**
 * Excel/CSV içe aktarma motoru.
 *
 * 1. Planlama: tüm sayfalar satır satır doğrulanır ve kayıtlar birbirine (ürün kodu/adı, müşteri adı,
 *    bölge adı) bağlanır. Hatalar sayfa + satır numarasıyla raporlanır. Veritabanına yazılmaz.
 * 2. Kaydetme: yalnızca hiç hata yoksa ve commit istenmişse, tek bir veritabanı işleminde yazılır.
 *    Herhangi bir adım başarısız olursa hiçbir değişiklik kalmaz.
 *
 * Kullanıcının kendi tabloları için esneklik:
 *  - Satışlarda ürün, kod yerine adıyla da belirtilebilir; tabloda olmayan ürün, müşteri ve bölgeler
 *    otomatik oluşturulur (özet uyarıyla bildirilir).
 *  - Birim fiyat yoksa tutar ÷ adet, adet yoksa tutar ÷ birim fiyat kullanılır.
 *  - Aynı türden birden fazla sayfa olabilir (ör. her ay ayrı sayfa).
 *
 * Modlar:
 *  - merge   (Ekle / güncelle): ürünler koda/ada, müşteriler ve çalışanlar ada, siparişler sipariş
 *            numarasına göre güncellenir; aynı dosya tekrar yüklenirse kayıtlar çoğalmaz.
 *  - replace (Tümünü değiştir): mevcut tüm iş verisi silinir, yerine dosyadaki veri yazılır.
 */
import { DEFAULT_EXPENSE_CATEGORY, nextId, upsertInventory } from '../data/entities.js';
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
} from '../data/validation.js';
import type { DbClient } from '../db/types.js';
import { todayIso } from '../utils/dates.js';
import type { ParsedRow, ParsedSheet } from './mapping.js';
import type { SheetKey } from './sheets.js';

export type ImportMode = 'merge' | 'replace';

export interface ImportIssue {
  sheet: string;
  row: number | null;
  /** İlgili alan (hataları gruplamak için) */
  field?: string;
  message: string;
}

/** Satırın veri olmadığını (iade, eksi, boş satır) belirtir: hata değil, sayılarak atlanır. */
class SkipRow extends Error {
  constructor(readonly reason: 'return' | 'empty') {
    super(reason);
  }
}

interface Tally {
  created: number;
  updated: number;
}

export interface ImportReport {
  mode: ImportMode;
  committed: boolean;
  ok: boolean;
  sheets: { key: SheetKey; title: string; sheetName: string; rows: number }[];
  counts: {
    regions: Tally;
    products: Tally;
    employees: Tally;
    customers: Tally;
    orders: Tally;
    orderItems: number;
    inventory: number;
    expenses: { created: number; skipped: number };
    payments: { created: number; skipped: number };
  };
  errors: ImportIssue[];
  warnings: ImportIssue[];
  /** Hata sayısı gösterim sınırını aştıysa */
  truncated: boolean;
  /** Hatalı satır sayısı (gösterim sınırından bağımsız) */
  rowErrors: number;
  /** skipInvalidRows ile atlanan hatalı satır sayısı */
  skippedRows: number;
}

const MAX_ISSUES = 200;
/** Bölge belirtilmediğinde kullanılan varsayılan bölge */
export const DEFAULT_REGION = 'Merkez';
const DEFAULT_CATEGORY = 'Genel';
const DEFAULT_CUSTOMER_TYPE = 'Bayi' as const;

// ── Plan tipleri ─────────────────────────────────────────────────────────────

interface RegionPlan {
  name: string;
  id: number | null;
}
interface ProductPlan {
  sku: string;
  name: string;
  category: string;
  unitCost: number;
  listPrice: number;
  id: number | null;
  /** Satış tablosundan otomatik oluşturulduysa, liste fiyatı satış fiyatlarının ortalamasıdır */
  priceSamples?: number[];
}
interface EmployeePlan {
  fullName: string;
  role: string;
  regionKey: string | null;
  monthlySalary: number;
  hireDate: string;
  id: number | null;
}
interface CustomerPlan {
  name: string;
  customerType: 'Bayi' | 'Mağaza';
  regionKey: string;
  salesRepKey: string | null;
  id: number | null;
  /** Cari bilgileri: yalnızca dosyada verildiyse yazılır (boşsa mevcut değer korunur) */
  taxId?: string | null;
  paymentTermDays?: number | null;
  creditLimit?: number | null;
}
interface OrderPlan {
  orderNo: string | null;
  orderDate: string;
  customerKey: string;
  status: 'delivered' | 'cancelled';
  department: string | null;
  project: string | null;
  dueDate: string | null;
  invoiceTotal: number | null;
  items: { product: ProductPlan; quantity: number; unitPrice: number }[];
  firstRow: number;
}
interface InventoryPlan {
  product: ProductPlan;
  regionKey: string;
  quantity: number;
}
interface ExpensePlan {
  expenseDate: string;
  category: string;
  amount: number;
  regionKey: string | null;
  description: string | null;
  department: string | null;
  project: string | null;
  supplier: string | null;
  dueDate: string | null;
  paidDate: string | null;
  invoiceNo: string | null;
  invoiceTotal: number | null;
}
interface PaymentPlan {
  paymentDate: string;
  customerKey: string;
  amount: number;
  method: string | null;
  reference: string | null;
  description: string | null;
}

/** VKN (10 hane) veya TCKN (11 hane); boşluk ve ayraçlar temizlenir */
function taxIdOf(value: unknown): string | null {
  const text = optionalText(value, 'Vergi no', 20);
  if (!text) return null;
  const digits = text.replace(/\D/g, '');
  if (digits.length !== 10 && digits.length !== 11) throw new FieldError('Vergi no', `"${text}" geçerli bir VKN (10 hane) veya TCKN (11 hane) değil.`);
  return digits;
}

/** Numarasız siparişlere verilen kalıcı numara: aynı dosya tekrar yüklenince eşleşir */
const autoOrderNo = (date: string, customerId: number) => `T${date.replace(/-/g, '')}-${customerId}`;

/** Ürün adından kod üretir: "El Dezenfektanı 1L" → "EL-DEZENFEKTANI-1L" */
function skuFromName(name: string, taken: (sku: string) => boolean): string {
  const base =
    matchKey(name)
      .toUpperCase()
      .replace(/[^A-Z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 30) || 'URUN';
  let sku = base;
  for (let n = 2; taken(sku); n++) sku = `${base}-${n}`;
  return sku;
}

export async function runImport(
  db: DbClient,
  sheets: ParsedSheet[],
  options: { mode: ImportMode; commit: boolean; /** Hatalı satırları atlayıp geçerli olanları içe aktar */ skipInvalidRows?: boolean },
): Promise<ImportReport> {
  const { mode } = options;
  const errors: ImportIssue[] = [];
  const warnings: ImportIssue[] = [];
  let truncated = false;
  const addError = (issue: ImportIssue) => {
    if (errors.length < MAX_ISSUES) errors.push(issue);
    else truncated = true;
  };
  const addWarning = (issue: ImportIssue) => {
    if (warnings.length < MAX_ISSUES) warnings.push(issue);
  };

  const report: ImportReport = {
    mode,
    committed: false,
    ok: false,
    sheets: sheets.map((s) => ({ key: s.spec.key, title: s.spec.title, sheetName: s.sheetName, rows: s.rows.length })),
    counts: {
      regions: { created: 0, updated: 0 },
      products: { created: 0, updated: 0 },
      employees: { created: 0, updated: 0 },
      customers: { created: 0, updated: 0 },
      orders: { created: 0, updated: 0 },
      orderItems: 0,
      inventory: 0,
      expenses: { created: 0, skipped: 0 },
      payments: { created: 0, skipped: 0 },
    },
    errors,
    warnings,
    truncated: false,
    rowErrors: 0,
    skippedRows: 0,
  };

  if (sheets.length === 0) {
    addError({
      sheet: 'Dosya',
      row: null,
      message: 'Dosyada içe aktarılacak bir tablo bulunamadı. Sütun eşleştirmesinde en az bir sayfanın veri türünü seçin.',
    });
    return report;
  }

  // ── Mevcut kayıtlar (Ekle/güncelle modunda eşleştirme için) ──
  const regions = new Map<string, RegionPlan>();
  const productsBySku = new Map<string, ProductPlan>();
  const productsByName = new Map<string, ProductPlan>();
  const employees = new Map<string, EmployeePlan>();
  const customers = new Map<string, CustomerPlan>();
  const existingOrderNos = new Map<string, number>();
  /** Vergi numarasıyla müşteri eşleştirme (e-Fatura ve ERP aktarımlarında ad farklı yazılmış olabilir) */
  const customersByTaxId = new Map<string, string>();

  const registerProduct = (p: ProductPlan) => {
    productsBySku.set(matchKey(p.sku), p);
    if (!productsByName.has(matchKey(p.name))) productsByName.set(matchKey(p.name), p);
  };

  if (mode === 'merge') {
    for (const r of await db.query<{ id: number; name: string }>('SELECT id, name FROM regions')) {
      regions.set(matchKey(r.name), { name: r.name, id: r.id });
    }
    for (const p of await db.query<ProductPlan>(
      'SELECT id, sku, name, category, unit_cost AS "unitCost", list_price AS "listPrice" FROM products',
    )) {
      registerProduct(p);
    }
    for (const e of await db.query<{ id: number; fullName: string }>('SELECT id, full_name AS "fullName" FROM employees')) {
      employees.set(matchKey(e.fullName), { fullName: e.fullName, role: '', regionKey: null, monthlySalary: 0, hireDate: '', id: e.id });
    }
    for (const c of await db.query<{ id: number; name: string; customerType: 'Bayi' | 'Mağaza'; regionName: string; taxId: string | null }>(
      'SELECT c.id, c.name, c.customer_type AS "customerType", r.name AS "regionName", c.tax_id AS "taxId" FROM customers c JOIN regions r ON r.id = c.region_id',
    )) {
      customers.set(matchKey(c.name), { name: c.name, customerType: c.customerType, regionKey: matchKey(c.regionName), salesRepKey: null, id: c.id });
      if (c.taxId) customersByTaxId.set(c.taxId, matchKey(c.name));
    }
    for (const o of await db.query<{ id: number; orderNo: string }>(
      'SELECT id, order_no AS "orderNo" FROM orders WHERE order_no IS NOT NULL',
    )) {
      existingOrderNos.set(o.orderNo, o.id);
    }
  }

  // Dosyada yeni tanımlanan / güncellenen kayıtlar
  const productRows = new Set<ProductPlan>();
  const employeeRows = new Map<string, EmployeePlan>();
  const customerRows = new Map<string, CustomerPlan>();
  const orders = new Map<string, OrderPlan>();
  const inventory = new Map<string, InventoryPlan>();
  const expenses: ExpensePlan[] = [];
  const payments: PaymentPlan[] = [];

  // Otomatik yapılan işlemlerin özeti (satır satır uyarı yerine)
  const autoProducts = new Set<string>();
  const autoCustomers = new Set<string>();
  const unknownCost = new Set<string>();
  let assumedSingleUnit = 0;
  let skippedReturns = 0;
  let skippedEmpty = 0;
  let filledRows = 0;

  /** Belirli türdeki tüm sayfaların satırlarını doğrular; alan hatasını satır numarasıyla kaydeder. */
  function eachRow(key: SheetKey, handle: (row: ParsedRow, sheet: string) => void) {
    for (const sheet of sheets.filter((s) => s.spec.key === key)) {
      const label = sheet.sheetName === sheet.spec.title ? sheet.spec.title : `${sheet.sheetName} (${sheet.spec.title})`;
      filledRows += sheet.filledRows;
      if (sheet.skippedTotals > 0) {
        addWarning({ sheet: label, row: null, message: `${sheet.skippedTotals} "Toplam" satırı veri sayılmadı ve atlandı.` });
      }
      if (sheet.missing.length > 0) {
        for (const field of sheet.missing) {
          addError({ sheet: label, row: null, message: `"${field}" bilgisini içeren sütun eşleştirilmedi. Sütun eşleştirmesinden ilgili sütunu seçin.` });
        }
        continue;
      }
      for (const row of sheet.rows) {
        try {
          handle(row, label);
        } catch (error) {
          if (error instanceof SkipRow) {
            if (error.reason === 'return') skippedReturns++;
            else skippedEmpty++;
          } else if (error instanceof FieldError) {
            report.rowErrors++;
            if (options.skipInvalidRows) report.skippedRows++;
            else addError({ sheet: label, row: row.rowNumber, field: error.field, message: error.message });
          } else throw error;
        }
      }
    }
  }

  const regionSheetNames = new Set<string>();
  /** Bölge adı geçerse ve yoksa otomatik oluşturulur. */
  function ensureRegion(name: string | null, sheet: string, row: number): string {
    const regionName = name ?? DEFAULT_REGION;
    const key = matchKey(regionName);
    if (!regions.has(key)) {
      regions.set(key, { name: regionName, id: null });
      if (!regionSheetNames.has(key)) {
        addWarning({
          sheet,
          row,
          message: name
            ? `"${regionName}" bölgesi otomatik olarak eklenecek.`
            : `Bölge belirtilmediği için "${DEFAULT_REGION}" bölgesi kullanılacak.`,
        });
      }
    }
    return key;
  }

  function findProduct(sku: string | null, name: string | null): ProductPlan | undefined {
    return (sku ? productsBySku.get(matchKey(sku)) : undefined) ?? (name ? productsByName.get(matchKey(name)) : undefined);
  }

  // ── Bölgeler ──
  eachRow('regions', (row) => {
    const name = requiredText(row.values.name, 'Bölge', 80);
    const key = matchKey(name);
    regionSheetNames.add(key);
    if (!regions.has(key)) regions.set(key, { name, id: null });
  });

  // ── Ürünler ──
  const productKeysInFile = new Set<string>();
  eachRow('products', (row, sheet) => {
    const v = row.values;
    const givenSku = optionalText(v.sku, 'Ürün kodu', 40);
    const givenName = optionalText(v.name, 'Ürün adı', 120);
    if (!givenSku && !givenName) throw new FieldError('Ürün', 'Ürün kodu veya ürün adı zorunludur.');
    const existing = findProduct(givenSku, givenName);
    const sku = givenSku ?? existing?.sku ?? skuFromName(givenName!, (s) => productsBySku.has(matchKey(s)));
    if (productKeysInFile.has(matchKey(sku))) {
      throw new FieldError('Ürün kodu', `"${sku}" ürünü bu sayfada birden fazla kez geçiyor.`);
    }
    productKeysInFile.add(matchKey(sku));
    const unitCost = optionalNumber(v.unitCost, 'Birim maliyet', { min: 0 });
    const plan: ProductPlan = {
      sku,
      name: givenName ?? existing?.name ?? sku,
      category: optionalText(v.category, 'Kategori', 60) ?? existing?.category ?? DEFAULT_CATEGORY,
      unitCost: unitCost ?? existing?.unitCost ?? 0,
      listPrice: requiredNumber(v.listPrice, 'Liste fiyatı', { min: 0 }),
      id: existing?.id ?? null,
    };
    if (plan.unitCost === 0) unknownCost.add(plan.name);
    if (plan.unitCost > 0 && plan.listPrice < plan.unitCost) {
      addWarning({ sheet, row: row.rowNumber, message: `"${plan.name}" ürününün liste fiyatı maliyetinin altında.` });
    }
    productRows.add(plan);
    registerProduct(plan);
  });

  // ── Çalışanlar ──
  eachRow('employees', (row, sheet) => {
    const v = row.values;
    const fullName = requiredText(v.fullName, 'Ad soyad', 100);
    const key = matchKey(fullName);
    if (employeeRows.has(key)) {
      throw new FieldError('Ad soyad', `"${fullName}" bu sayfada birden fazla kez geçiyor.`);
    }
    const regionName = optionalText(v.region, 'Bölge', 80);
    const plan: EmployeePlan = {
      fullName,
      role: requiredText(v.role, 'Görev', 80),
      regionKey: regionName ? ensureRegion(regionName, sheet, row.rowNumber) : null,
      monthlySalary: requiredNumber(v.monthlySalary, 'Aylık maaş', { min: 0 }),
      hireDate: optionalDate(v.hireDate, 'İşe başlama tarihi') ?? todayIso(),
      id: employees.get(key)?.id ?? null,
    };
    employeeRows.set(key, plan);
    employees.set(key, plan);
  });

  // ── Müşteriler ──
  eachRow('customers', (row, sheet) => {
    const v = row.values;
    const name = requiredText(v.name, 'Müşteri adı', 120);
    const key = matchKey(name);
    if (customerRows.has(key)) {
      throw new FieldError('Müşteri adı', `"${name}" müşterisi bu sayfada birden fazla kez geçiyor.`);
    }
    const customerType = oneOf(v.customerType, 'Tip', CUSTOMER_TYPES, customers.get(key)?.customerType ?? DEFAULT_CUSTOMER_TYPE);
    const regionKey = ensureRegion(optionalText(v.region, 'Bölge', 80), sheet, row.rowNumber);
    const repName = optionalText(v.salesRep, 'Satış temsilcisi', 100);
    let salesRepKey: string | null = null;
    if (repName) {
      if (employees.has(matchKey(repName))) salesRepKey = matchKey(repName);
      else addWarning({ sheet, row: row.rowNumber, message: `"${repName}" çalışanı bulunamadı; satış temsilcisi boş bırakılacak.` });
    }
    const taxId = taxIdOf(v.taxId);
    const paymentTermDays = optionalNumber(v.paymentTermDays, 'Vade (gün)', { min: 0 });
    const creditLimit = optionalNumber(v.creditLimit, 'Kredi limiti', { min: 0 });
    const plan: CustomerPlan = {
      name, customerType, regionKey, salesRepKey, id: customers.get(key)?.id ?? null,
      taxId, paymentTermDays: paymentTermDays === null ? null : Math.round(paymentTermDays), creditLimit,
    };
    customerRows.set(key, plan);
    customers.set(key, plan);
    if (taxId) customersByTaxId.set(taxId, key);
  });

  // ── Satışlar ──
  eachRow('sales', (row, sheet) => {
    const v = row.values;
    const blank = (x: unknown) => x === null || x === undefined || (typeof x === 'string' && x.trim() === '');
    // Ürün, adet ve tutar içermeyen satırlar (not, ara başlık, boş satır) veri değildir
    if (blank(v.sku) && blank(v.productName) && blank(v.quantity) && blank(v.lineTotal)) throw new SkipRow('empty');
    // 1) Önce satırın tamamı doğrulanır; hatalı satır hiçbir kayıt oluşturmaz
    const orderDate = requiredDate(v.orderDate, 'Tarih');
    const customerName = requiredText(v.customer, 'Müşteri', 120);
    const customerTaxId = taxIdOf(v.customerTaxId);
    // Vergi numarası kayıtlı bir müşteriyle eşleşiyorsa (ad farklı yazılmış olsa da) o müşteri
    const customerKey = (customerTaxId && customersByTaxId.get(customerTaxId)) || matchKey(customerName);
    const dueDate = optionalDate(v.dueDate, 'Vade tarihi');
    const invoiceTotal = optionalNumber(v.invoiceTotal, 'Fatura toplamı', { min: 0 });
    const sku = optionalText(v.sku, 'Ürün kodu', 40);
    const productName = optionalText(v.productName, 'Ürün adı', 120);
    if (!sku && !productName) throw new FieldError('Ürün', 'Ürün kodu veya ürün adı boş.');
    let product = findProduct(sku, productName);
    const rowCost = optionalNumber(v.unitCost, 'Birim maliyet', { min: 0 });

    // Adet / birim fiyat / tutar: eksik olan diğerlerinden hesaplanır
    let quantity = optionalNumber(v.quantity, 'Adet');
    let unitPrice = optionalNumber(v.unitPrice, 'Birim fiyat');
    const lineTotal = optionalNumber(v.lineTotal, 'Tutar');
    // İade / eksi / sıfır adetli satırlar satış analizine alınmaz (özet uyarıyla bildirilir)
    if ((quantity !== null && quantity <= 0) || (lineTotal !== null && lineTotal < 0) || (unitPrice !== null && unitPrice < 0)) {
      throw new SkipRow('return');
    }
    let singleUnit = false;
    if (quantity === null) {
      if (lineTotal !== null && unitPrice) quantity = Math.round((lineTotal / unitPrice) * 1000) / 1000;
      else if (lineTotal !== null) {
        quantity = 1;
        singleUnit = true;
      } else throw new FieldError('Adet', 'Adet (miktar) veya tutar boş.');
    }
    if (quantity <= 0) throw new SkipRow('return');
    if (unitPrice === null) {
      if (lineTotal !== null) unitPrice = Math.round((lineTotal / quantity) * 100) / 100;
      else if (product && product.listPrice > 0) unitPrice = product.listPrice;
      else throw new FieldError('Fiyat', `"${productName ?? sku}" için birim fiyat veya tutar gerekli.`);
    }
    if (unitPrice < 0) throw new FieldError('Fiyat', 'Birim fiyat negatif olamaz.');
    const status = oneOf(v.status, 'Durum', ORDER_STATUSES, 'delivered');
    const orderNo = optionalText(v.orderNo, 'Sipariş no', 40);
    const regionName = optionalText(v.region, 'Bölge', 80);
    const customerType = customers.has(customerKey) ? null : oneOf(v.customerType, 'Müşteri tipi', CUSTOMER_TYPES, DEFAULT_CUSTOMER_TYPE);
    const category = optionalText(v.category, 'Kategori', 60);
    const department = optionalText(v.department, 'Departman', 80);
    const project = optionalText(v.project, 'Proje', 80);

    // Sipariş numarası yoksa aynı gün + aynı müşteri satırları tek sipariş sayılır
    const groupKey = orderNo ? `no:${orderNo}` : `auto:${orderDate}|${customerKey}`;
    const existing = orders.get(groupKey);
    if (existing && (existing.orderDate !== orderDate || existing.customerKey !== customerKey)) {
      throw new FieldError('Sipariş no', `"${orderNo}" siparişinin satırlarında farklı tarih veya müşteri var (ilk satır: ${existing.firstRow}).`);
    }

    // 2) Tabloda henüz olmayan müşteri ve ürün otomatik oluşturulur
    if (customerType) {
      const plan: CustomerPlan = { name: customerName, customerType, regionKey: ensureRegion(regionName, sheet, row.rowNumber), salesRepKey: null, id: null, taxId: customerTaxId };
      customers.set(customerKey, plan);
      customerRows.set(customerKey, plan);
      if (customerTaxId) customersByTaxId.set(customerTaxId, customerKey);
      autoCustomers.add(customerName);
    } else if (customerTaxId && !customerRows.has(customerKey)) {
      // Kayıtlı müşterinin vergi numarası yoksa e-Fatura/ERP'den gelen yazılır
      const existingCustomer = customers.get(customerKey)!;
      if (existingCustomer.taxId === undefined) {
        existingCustomer.taxId = customerTaxId;
        customerRows.set(customerKey, existingCustomer);
      }
    }
    if (!product) {
      const name = productName ?? sku!;
      product = {
        sku: sku ?? skuFromName(name, (s) => productsBySku.has(matchKey(s))),
        name,
        category: category ?? DEFAULT_CATEGORY,
        unitCost: rowCost ?? 0,
        listPrice: 0,
        id: null,
        priceSamples: [],
      };
      registerProduct(product);
      productRows.add(product);
      autoProducts.add(name);
    } else if (product.priceSamples && rowCost !== null && product.unitCost === 0) {
      product.unitCost = rowCost;
    }
    product.priceSamples?.push(unitPrice);
    if (singleUnit) assumedSingleUnit++;

    if (existing) {
      existing.items.push({ product, quantity, unitPrice });
      // Departman/proje sipariş düzeyindedir: yalnızca ilk kalemde yazılmış olabilir
      existing.department ??= department;
      existing.project ??= project;
      existing.dueDate ??= dueDate;
      existing.invoiceTotal ??= invoiceTotal;
    } else {
      orders.set(groupKey, { orderNo, orderDate, customerKey, status, department, project, dueDate, invoiceTotal, items: [{ product, quantity, unitPrice }], firstRow: row.rowNumber });
    }
  });
  // ── Stok ──
  eachRow('inventory', (row, sheet) => {
    const v = row.values;
    const sku = optionalText(v.sku, 'Ürün kodu', 40);
    const name = optionalText(v.productName, 'Ürün adı', 120);
    const product = findProduct(sku, name);
    if (!product) throw new FieldError('Ürün', `"${sku ?? name}" ürünü bulunamadı. Önce ürünlere veya satışlara ekleyin.`);
    const regionKey = ensureRegion(optionalText(v.region, 'Bölge', 80), sheet, row.rowNumber);
    const key = `${matchKey(product.sku)}|${regionKey}`;
    if (inventory.has(key)) {
      throw new FieldError('Ürün', `"${product.name}" ürününün bu bölgedeki stoğu birden fazla kez girilmiş.`);
    }
    inventory.set(key, { product, regionKey, quantity: requiredNumber(v.quantity, 'Mevcut stok', { min: 0 }) });
  });

  // ── Giderler ──
  eachRow('expenses', (row, sheet) => {
    const v = row.values;
    const regionName = optionalText(v.region, 'Bölge', 80);
    expenses.push({
      expenseDate: requiredDate(v.expenseDate, 'Tarih'),
      category: optionalText(v.category, 'Gider türü', 60) ?? DEFAULT_EXPENSE_CATEGORY,
      amount: requiredNumber(v.amount, 'Tutar', { min: 0 }),
      regionKey: regionName ? ensureRegion(regionName, sheet, row.rowNumber) : null,
      description: optionalText(v.description, 'Açıklama', 300),
      department: optionalText(v.department, 'Departman', 80),
      project: optionalText(v.project, 'Proje', 80),
      supplier: optionalText(v.supplier, 'Tedarikçi', 120),
      dueDate: optionalDate(v.dueDate, 'Vade tarihi'),
      paidDate: optionalDate(v.paidDate, 'Ödeme tarihi'),
      invoiceNo: optionalText(v.invoiceNo, 'Fatura no', 60),
      invoiceTotal: optionalNumber(v.invoiceTotal, 'Fatura toplamı', { min: 0 }),
    });
  });

  // ── Tahsilatlar ──
  eachRow('payments', (row) => {
    const v = row.values;
    const customerName = requiredText(v.customer, 'Müşteri', 120);
    const customerKey = matchKey(customerName);
    if (!customers.has(customerKey)) {
      throw new FieldError('Müşteri', `"${customerName}" müşterisi bulunamadı. Önce müşterilere veya satışlara ekleyin.`);
    }
    payments.push({
      paymentDate: requiredDate(v.paymentDate, 'Tarih'),
      customerKey,
      amount: requiredNumber(v.amount, 'Tutar', { min: 0.01 }),
      method: optionalText(v.method, 'Yöntem', 40),
      reference: optionalText(v.reference, 'Belge no', 60),
      description: optionalText(v.description, 'Açıklama', 300),
    });
  });

  // Satıştan oluşturulan ürünlerin liste fiyatı: satış fiyatlarının ortalaması
  for (const product of productRows) {
    if (product.priceSamples && product.priceSamples.length > 0 && product.listPrice === 0) {
      product.listPrice = Math.round((product.priceSamples.reduce((a, b) => a + b, 0) / product.priceSamples.length) * 100) / 100;
    }
    if (product.unitCost === 0) unknownCost.add(product.name);
  }

  // ── Özet uyarılar ──
  const list = (names: Set<string>) => {
    const items = [...names];
    return items.slice(0, 5).map((n) => `"${n}"`).join(', ') + (items.length > 5 ? ` ve ${items.length - 5} tane daha` : '');
  };
  if (autoProducts.size > 0) {
    addWarning({ sheet: 'Özet', row: null, message: `${autoProducts.size} ürün satış tablosundan otomatik oluşturulacak (${list(autoProducts)}). Liste fiyatı, satış fiyatlarının ortalaması olarak ayarlanır.` });
  }
  if (autoCustomers.size > 0) {
    addWarning({ sheet: 'Özet', row: null, message: `${autoCustomers.size} müşteri satış tablosundan otomatik oluşturulacak (${list(autoCustomers)}). Tipleri belirtilmediyse "${DEFAULT_CUSTOMER_TYPE}" olarak ayarlanır; Müşteriler sekmesinden değiştirebilirsiniz.` });
  }
  if (unknownCost.size > 0) {
    addWarning({ sheet: 'Özet', row: null, message: `${unknownCost.size} ürünün maliyeti bilinmiyor (${list(unknownCost)}). Bu ürünler marj analizine dahil edilmez; maliyeti Ürünler sekmesinden girebilirsiniz.` });
  }
  if (skippedReturns > 0) {
    addWarning({ sheet: 'Özet', row: null, message: `${skippedReturns} satış satırı eksi veya sıfır adet/tutar içerdiği için (iade, düzeltme vb.) satış analizine alınmadı.` });
  }
  if (skippedEmpty > 0) {
    addWarning({ sheet: 'Özet', row: null, message: `${skippedEmpty} satırda ürün, adet ve tutar olmadığı için veri sayılmadı (not, ara başlık vb.).` });
  }
  if (filledRows > 0) {
    addWarning({ sheet: 'Özet', row: null, message: `${filledRows} satırdaki boş tarih/müşteri hücresi üstteki satırdan tamamlandı (gruplanmış veya birleştirilmiş hücreler).` });
  }
  if (report.skippedRows > 0) {
    addWarning({ sheet: 'Özet', row: null, message: `${report.skippedRows} hatalı satır atlandı; geri kalan satırlar içe aktarılacak.` });
  }
  if (assumedSingleUnit > 0) {
    addWarning({ sheet: 'Özet', row: null, message: `${assumedSingleUnit} satış satırında adet yok; her biri 1 adet ve tutarı birim fiyat olarak kaydedilecek.` });
  }

  // ── Tahmini sayılar (kontrol raporu) ──
  const tally = <T extends { id: number | null }>(plans: Iterable<T>): Tally => {
    const all = [...plans];
    const updated = all.filter((p) => p.id !== null).length;
    return { created: all.length - updated, updated };
  };
  const c = report.counts;
  c.regions = { created: [...regions.values()].filter((r) => r.id === null).length, updated: 0 };
  c.products = tally(productRows);
  c.employees = tally(employeeRows.values());
  c.customers = tally(customerRows.values());
  /** Numarasız siparişler, müşterisi zaten kayıtlıysa önceki yüklemedeki otomatik numarayla eşleşir */
  const plannedOrderNo = (o: OrderPlan) => {
    if (o.orderNo !== null) return o.orderNo;
    const customerId = customers.get(o.customerKey)?.id;
    return customerId ? autoOrderNo(o.orderDate, customerId) : null;
  };
  const willUpdate = (o: OrderPlan) => {
    const no = plannedOrderNo(o);
    return no !== null && existingOrderNos.has(no);
  };
  c.orders = {
    created: [...orders.values()].filter((o) => !willUpdate(o)).length,
    updated: [...orders.values()].filter(willUpdate).length,
  };
  c.orderItems = [...orders.values()].reduce((total, o) => total + o.items.length, 0);
  c.inventory = inventory.size;
  c.expenses = { created: expenses.length, skipped: 0 };
  c.payments = { created: payments.length, skipped: 0 };

  report.truncated = truncated;
  report.ok = errors.length === 0;
  if (!report.ok || !options.commit) return report;

  // ── Kaydetme (tek işlem) ──
  await db.transaction(async (tx) => {
    if (mode === 'replace') {
      for (const table of ['payments', 'order_items', 'orders', 'inventory', 'expenses', 'customers', 'employees', 'products', 'regions']) {
        await tx.execute(`DELETE FROM ${table}`);
      }
    }

    const ids = {
      regions: await nextId(tx, 'regions'),
      products: await nextId(tx, 'products'),
      employees: await nextId(tx, 'employees'),
      customers: await nextId(tx, 'customers'),
      orders: await nextId(tx, 'orders'),
      orderItems: await nextId(tx, 'order_items'),
      expenses: await nextId(tx, 'expenses'),
      payments: await nextId(tx, 'payments'),
    };

    for (const region of regions.values()) {
      if (region.id !== null) continue;
      region.id = ids.regions++;
      await tx.execute('INSERT INTO regions (id, name) VALUES (?, ?)', [region.id, region.name]);
    }
    const regionId = (key: string | null) => (key === null ? null : regions.get(key)!.id);

    for (const p of productRows) {
      if (p.id === null) {
        p.id = ids.products++;
        await tx.execute('INSERT INTO products (id, sku, name, category, unit_cost, list_price) VALUES (?, ?, ?, ?, ?, ?)', [
          p.id, p.sku, p.name, p.category, p.unitCost, p.listPrice,
        ]);
      } else {
        await tx.execute('UPDATE products SET sku = ?, name = ?, category = ?, unit_cost = ?, list_price = ? WHERE id = ?', [
          p.sku, p.name, p.category, p.unitCost, p.listPrice, p.id,
        ]);
      }
    }

    for (const e of employeeRows.values()) {
      if (e.id === null) {
        e.id = ids.employees++;
        await tx.execute(
          'INSERT INTO employees (id, full_name, role, region_id, monthly_salary, hire_date) VALUES (?, ?, ?, ?, ?, ?)',
          [e.id, e.fullName, e.role, regionId(e.regionKey), e.monthlySalary, e.hireDate],
        );
      } else {
        await tx.execute('UPDATE employees SET role = ?, region_id = ?, monthly_salary = ?, hire_date = ? WHERE id = ?', [
          e.role, regionId(e.regionKey), e.monthlySalary, e.hireDate, e.id,
        ]);
      }
    }

    const repId = (key: string | null) => (key === null ? null : employees.get(key)!.id);
    for (const cu of customerRows.values()) {
      if (cu.id === null) {
        cu.id = ids.customers++;
        await tx.execute(
          'INSERT INTO customers (id, name, customer_type, region_id, sales_rep_id, created_at, tax_id, payment_term_days, credit_limit) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
          [cu.id, cu.name, cu.customerType, regionId(cu.regionKey), repId(cu.salesRepKey), todayIso(), cu.taxId ?? null, cu.paymentTermDays ?? null, cu.creditLimit ?? null],
        );
      } else {
        await tx.execute('UPDATE customers SET customer_type = ?, region_id = ?, sales_rep_id = ? WHERE id = ?', [
          cu.customerType, regionId(cu.regionKey), repId(cu.salesRepKey), cu.id,
        ]);
        // Cari bilgileri yalnızca dosyada verildiyse güncellenir
        if (cu.taxId) await tx.execute('UPDATE customers SET tax_id = ? WHERE id = ?', [cu.taxId, cu.id]);
        if (cu.paymentTermDays !== undefined && cu.paymentTermDays !== null) await tx.execute('UPDATE customers SET payment_term_days = ? WHERE id = ?', [cu.paymentTermDays, cu.id]);
        if (cu.creditLimit !== undefined && cu.creditLimit !== null) await tx.execute('UPDATE customers SET credit_limit = ? WHERE id = ?', [cu.creditLimit, cu.id]);
      }
    }

    // Sipariş bölgesi ve temsilcisi müşteriden gelir
    const customerInfo = new Map(
      (await tx.query<{ id: number; regionId: number; salesRepId: number | null }>(
        'SELECT id, region_id AS "regionId", sales_rep_id AS "salesRepId" FROM customers',
      )).map((row) => [row.id, row]),
    );

    c.orders = { created: 0, updated: 0 };
    for (const order of orders.values()) {
      const customerId = customers.get(order.customerKey)!.id!;
      const info = customerInfo.get(customerId)!;
      // Numarasız siparişlere kalıcı bir numara verilir: aynı dosya tekrar yüklenirse eşleşir
      const orderNo = order.orderNo ?? autoOrderNo(order.orderDate, customerId);
      let orderId = existingOrderNos.get(orderNo);
      if (orderId !== undefined) {
        c.orders.updated++;
        await tx.execute('DELETE FROM order_items WHERE order_id = ?', [orderId]);
        await tx.execute(
          'UPDATE orders SET customer_id = ?, region_id = ?, sales_rep_id = ?, order_date = ?, status = ?, department = ?, project = ?, due_date = ?, invoice_total = ? WHERE id = ?',
          [customerId, info.regionId, info.salesRepId, order.orderDate, order.status, order.department, order.project, order.dueDate, order.invoiceTotal, orderId],
        );
      } else {
        c.orders.created++;
        orderId = ids.orders++;
        existingOrderNos.set(orderNo, orderId);
        await tx.execute(
          'INSERT INTO orders (id, customer_id, region_id, sales_rep_id, order_date, status, order_no, department, project, due_date, invoice_total) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
          [orderId, customerId, info.regionId, info.salesRepId, order.orderDate, order.status, orderNo, order.department, order.project, order.dueDate, order.invoiceTotal],
        );
      }
      for (const item of order.items) {
        await tx.execute('INSERT INTO order_items (id, order_id, product_id, quantity, unit_price) VALUES (?, ?, ?, ?, ?)', [
          ids.orderItems++, orderId, item.product.id, item.quantity, item.unitPrice,
        ]);
      }
    }

    for (const row of inventory.values()) {
      await upsertInventory(tx, row.product.id!, regionId(row.regionKey)!, row.quantity);
    }

    c.expenses = { created: 0, skipped: 0 };
    for (const x of expenses) {
      const region = regionId(x.regionKey);
      if (mode === 'merge' && x.invoiceNo) {
        // Fatura numarası olan gider (e-Fatura, ERP) numarasıyla eşleşir: ödeme bilgisi güncellenir
        const existingInvoice = await tx.queryOne<{ id: number }>('SELECT id FROM expenses WHERE invoice_no = ? AND COALESCE(supplier, \'\') = COALESCE(?, \'\')', [x.invoiceNo, x.supplier]);
        if (existingInvoice) {
          if (x.paidDate) await tx.execute('UPDATE expenses SET paid_date = ? WHERE id = ?', [x.paidDate, existingInvoice.id]);
          c.expenses.skipped++;
          continue;
        }
      } else if (mode === 'merge') {
        // Aynı gider daha önce yüklendiyse tekrar eklenmez
        const duplicate = await tx.queryOne<{ id: number }>(
          `SELECT id FROM expenses WHERE expense_date = ? AND category = ? AND amount = ?
             AND COALESCE(region_id, 0) = COALESCE(?, 0) AND COALESCE(description, '') = COALESCE(?, '')
             AND COALESCE(department, '') = COALESCE(?, '') AND COALESCE(project, '') = COALESCE(?, '')`,
          [x.expenseDate, x.category, x.amount, region, x.description, x.department, x.project],
        );
        if (duplicate) {
          c.expenses.skipped++;
          continue;
        }
      }
      await tx.execute(
        'INSERT INTO expenses (id, expense_date, category, amount, region_id, description, department, project, supplier, due_date, paid_date, invoice_no, invoice_total) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [ids.expenses++, x.expenseDate, x.category, x.amount, region, x.description, x.department, x.project, x.supplier, x.dueDate, x.paidDate, x.invoiceNo, x.invoiceTotal],
      );
      c.expenses.created++;
    }

    c.payments = { created: 0, skipped: 0 };
    for (const pay of payments) {
      const customerId = customers.get(pay.customerKey)!.id!;
      if (mode === 'merge') {
        // Aynı tahsilat (tarih, müşteri, tutar, belge no) tekrar yüklenirse eklenmez
        const duplicate = await tx.queryOne<{ id: number }>(
          `SELECT id FROM payments WHERE customer_id = ? AND payment_date = ? AND amount = ? AND COALESCE(reference, '') = COALESCE(?, '')`,
          [customerId, pay.paymentDate, pay.amount, pay.reference],
        );
        if (duplicate) {
          c.payments.skipped++;
          continue;
        }
      }
      await tx.execute(
        'INSERT INTO payments (id, customer_id, payment_date, amount, method, reference, description) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [ids.payments++, customerId, pay.paymentDate, pay.amount, pay.method, pay.reference, pay.description],
      );
      c.payments.created++;
    }
  });

  report.committed = true;
  return report;
}
