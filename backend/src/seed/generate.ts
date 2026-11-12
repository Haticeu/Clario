import type { DbClient } from '../db/types.js';
import { resetSchema } from '../db/schema.js';
import {
  addDays,
  addMonths,
  daysBetween,
  firstDayOfMonth,
  isSunday,
  lastDayOfMonth,
  monthKey,
  parseIsoDate,
  todayIso,
} from '../utils/dates.js';
import { round } from '../utils/stats.js';
import { CUSTOMERS, EMPLOYEES, PRODUCTS, REGIONS, WAREHOUSE_RENT, type ProductSeed } from './catalog.js';
import { createRng, type Rng } from './random.js';
import { SCENARIOS } from './scenarios.js';

export interface SeedOptions {
  /** Verinin "bugün"ü. Varsayılan: sistem tarihi. */
  asOf?: string;
  /** Kaç aylık geçmiş üretilecek. */
  months?: number;
  /** Rastgele üreteç tohumu (aynı tohum → aynı veri). */
  randomSeed?: number;
}

export interface SeedSummary {
  asOf: string;
  startDate: string;
  regions: number;
  products: number;
  employees: number;
  customers: number;
  orders: number;
  orderItems: number;
  inventoryRows: number;
  expenses: number;
  deliveredRevenue: number;
}

interface CustomerProfile {
  id: number;
  name: string;
  customerType: 'Bayi' | 'Mağaza';
  regionId: number;
  salesRepId: number;
  createdAt: string;
  /** Tüketim ölçeği (bayiler büyük, mağazalar küçük). */
  size: number;
  /** Ardışık teslimatlar arası gün döngüsü: haftalık [7], haftada iki kez [3, 4]. */
  routeGaps: readonly number[];
  /** İlk rota günü (0 = Pazar … 6 = Cumartesi). */
  routeWeekday: number;
  /** Liste fiyatına uygulanan ortalama iskonto. */
  discount: number;
  basket: number[];
  /** Bu tarihten sonra sipariş vermeyi bırakır (kayıp senaryosu). */
  silentAfter: string | null;
}

interface GeneratedOrder {
  customerId: number;
  regionId: number;
  salesRepId: number;
  orderDate: string;
  status: 'delivered' | 'cancelled';
  items: { productId: number; quantity: number; unitPrice: number }[];
}

const DEFAULT_RANDOM_SEED = 20_260_925;
const CANCELLATION_RATE = 0.015;
/** Teslimatın rota gününden ±1 gün kayma olasılığı. */
const ROUTE_SHIFT_RATE = 0.15;
/** Haftada iki kez teslimat alan mağazaların oranı. */
const TWICE_WEEKLY_STORE_SHARE = 0.4;
/** Genel iş büyümesi: ayda ~%1,5. */
const MONTHLY_GROWTH = 0.015;
const LOGISTICS_COST_SHARE = 0.04;
const HEALTHY_STOCK_MONTHS = { min: 2.0, max: 3.2 };

const productBySku = new Map(PRODUCTS.map((p) => [p.sku, p]));
const regionIdByName = new Map<string, number>(REGIONS.map((r) => [r.name, r.id]));

function productIdOf(sku: string): number {
  const product = productBySku.get(sku);
  if (!product) throw new Error(`Senaryo ürünü katalogda yok: ${sku}`);
  return product.id;
}

const DECLINE_PRODUCT_ID = productIdOf(SCENARIOS.salesDeclineWithOverstock.sku);
const SURGE_PRODUCT_ID = productIdOf(SCENARIOS.regionalDemandSurge.sku);
const SURGE_REGION_ID = regionIdByName.get(SCENARIOS.regionalDemandSurge.regionName)!;
const LOW_STOCK_PRODUCT_ID = productIdOf(SCENARIOS.lowStock.sku);

function salesRepFor(regionId: number, customerId: number): number {
  const reps = EMPLOYEES.filter((e) => e.role === 'Satış Temsilcisi' && e.regionId === regionId);
  return reps[customerId % reps.length]!.id;
}

function buildCustomerProfiles(rng: Rng, asOf: string, startDate: string): CustomerProfile[] {
  const silentNames = new Set<string>(SCENARIOS.silentDealers.customerNames);

  return CUSTOMERS.map((seed) => {
    const isDealer = seed.customerType === 'Bayi';
    const isSilent = silentNames.has(seed.name);

    const basket = rng
      .shuffle(PRODUCTS.map((p) => p.id))
      .slice(0, rng.int(6, 9));
    // Bayiler endüstriyel ürünü, senaryo bölgesindeki müşteriler senaryo ürününü mutlaka taşır.
    if (isDealer && !basket.includes(DECLINE_PRODUCT_ID)) basket.push(DECLINE_PRODUCT_ID);
    if (seed.regionId === SURGE_REGION_ID && !basket.includes(SURGE_PRODUCT_ID)) basket.push(SURGE_PRODUCT_ID);

    const { min, max } = SCENARIOS.silentDealers.silentDays;
    // Sevkiyat rotası: bayiler haftalık; mağazaların bir kısmı haftada iki kez (ör. Pzt + Per).
    const twiceWeekly = !isDealer && rng.chance(TWICE_WEEKLY_STORE_SHARE);
    return {
      ...seed,
      salesRepId: salesRepFor(seed.regionId, seed.id),
      createdAt: addDays(startDate, -rng.int(60, 900)),
      size: isDealer ? rng.between(1.8, 3.0) : rng.between(0.6, 1.2),
      routeGaps: twiceWeekly ? [3, 4] : [7],
      routeWeekday: twiceWeekly ? rng.int(1, 3) : rng.int(1, 6), // iki teslimat da Pzt–Cmt arasında kalır
      discount: isDealer ? rng.between(0.06, 0.09) : rng.between(0.01, 0.04),
      basket: basket.sort((a, b) => a - b),
      silentAfter: isSilent ? addDays(asOf, -rng.int(min, max)) : null,
    };
  });
}

/** Tarihe, ürüne ve bölgeye göre talep çarpanı: genel büyüme + enjekte edilen senaryolar. */
function demandMultiplier(product: ProductSeed, regionId: number, date: string, startDate: string, asOf: string) {
  let multiplier = 1 + MONTHLY_GROWTH * (daysBetween(startDate, date) / 30);
  const daysAgo = daysBetween(date, asOf);

  const decline = SCENARIOS.salesDeclineWithOverstock;
  if (product.id === DECLINE_PRODUCT_ID && daysAgo < decline.startsDaysAgo) {
    multiplier *= decline.demandMultiplier;
  }

  const surge = SCENARIOS.regionalDemandSurge;
  if (product.id === SURGE_PRODUCT_ID && regionId === SURGE_REGION_ID && daysAgo < surge.startsDaysAgo) {
    multiplier *= surge.demandMultiplier;
  }

  return multiplier;
}

/**
 * B2B dağıtımda müşteriler sabit bir sevkiyat rotasıyla (ör. her salı) sipariş verir;
 * tatil/yoğunluk nedeniyle teslimat ara sıra ±1 gün kayar. Müşteriler "tükettiği kadar
 * sipariş verir": miktar = önceki siparişten bu yana geçen gün × günlük tüketim.
 */
function generateOrders(rng: Rng, customers: CustomerProfile[], startDate: string, asOf: string): GeneratedOrder[] {
  const orders: GeneratedOrder[] = [];

  for (const customer of customers) {
    const lastAllowed = customer.silentAfter ?? asOf;
    let routeDate = startDate;
    while (parseIsoDate(routeDate).getUTCDay() !== customer.routeWeekday) routeDate = addDays(routeDate, 1);

    const gaps = customer.routeGaps;
    let previousDate = addDays(routeDate, -gaps.at(-1)!);

    for (let n = 0; ; routeDate = addDays(routeDate, gaps[n++ % gaps.length]!)) {
      const shift = rng.chance(ROUTE_SHIFT_RATE) ? (rng.chance(0.5) ? 1 : -1) : 0;
      let date = addDays(routeDate, shift);
      if (isSunday(date)) date = addDays(date, 1); // pazar günü sevkiyat yok
      if (date > lastAllowed) break;
      const coveredDays = daysBetween(previousDate, date);
      previousDate = date;

      const items = customer.basket.map((productId) => {
        const product = PRODUCTS[productId - 1]!;
        const dailyUnits =
          product.dailyDemand * customer.size * demandMultiplier(product, customer.regionId, date, startDate, asOf);
        const quantity = Math.max(1, Math.round(dailyUnits * coveredDays * rng.between(0.85, 1.15)));
        const discount = Math.min(0.2, Math.max(0, customer.discount + rng.between(-0.01, 0.01)));
        return { productId, quantity, unitPrice: round(product.listPrice * (1 - discount), 2) };
      });

      orders.push({
        customerId: customer.id,
        regionId: customer.regionId,
        salesRepId: customer.salesRepId,
        orderDate: date,
        status: rng.chance(CANCELLATION_RATE) ? 'cancelled' : 'delivered',
        items,
      });
    }
  }

  return orders.sort((a, b) => a.orderDate.localeCompare(b.orderDate) || a.customerId - b.customerId);
}

/**
 * Stok, son 30 günlük bölgesel satış hızının belirli bir katı olarak kurulur.
 * Normal ürünler sağlıklı aralıkta (2–3,2 ay) tutulur; senaryo ürünleri bilinçli olarak saptırılır.
 */
function generateInventory(rng: Rng, orders: GeneratedOrder[], asOf: string) {
  const windowStart = addDays(asOf, -30);
  const unitsLast30 = new Map<string, number>();
  for (const order of orders) {
    if (order.status !== 'delivered' || order.orderDate <= windowStart) continue;
    for (const item of order.items) {
      const key = `${item.productId}:${order.regionId}`;
      unitsLast30.set(key, (unitsLast30.get(key) ?? 0) + item.quantity);
    }
  }

  const rows: { productId: number; regionId: number; quantity: number }[] = [];
  for (const product of PRODUCTS) {
    for (const region of REGIONS) {
      const monthlyUnits = unitsLast30.get(`${product.id}:${region.id}`) ?? 0;
      let months = rng.between(HEALTHY_STOCK_MONTHS.min, HEALTHY_STOCK_MONTHS.max);

      if (product.id === DECLINE_PRODUCT_ID) {
        const { min, max } = SCENARIOS.salesDeclineWithOverstock.stockMonths;
        months = rng.between(min, max);
      } else if (product.id === LOW_STOCK_PRODUCT_ID) {
        const { min, max } = SCENARIOS.lowStock.stockMonths;
        months = rng.between(min, max);
      } else if (product.id === SURGE_PRODUCT_ID && region.id === SURGE_REGION_ID) {
        // Stok artıştan önceki (eski) talebe göre planlanmış: yeni talebe göre çok az kalır.
        months = SCENARIOS.regionalDemandSurge.regionStockMonths;
      }

      rows.push({ productId: product.id, regionId: region.id, quantity: Math.round(monthlyUnits * months) });
    }
  }
  return rows;
}

function generateExpenses(rng: Rng, orders: GeneratedOrder[], startDate: string, asOf: string) {
  const revenueByMonth = new Map<string, number>();
  for (const order of orders) {
    if (order.status !== 'delivered') continue;
    const revenue = order.items.reduce((total, item) => total + item.quantity * item.unitPrice, 0);
    const key = monthKey(order.orderDate);
    revenueByMonth.set(key, (revenueByMonth.get(key) ?? 0) + revenue);
  }

  const payroll = EMPLOYEES.reduce((total, e) => total + e.monthlySalary, 0);
  const expenses: { expenseDate: string; category: string; amount: number; regionId: number | null; description: string }[] = [];

  for (let month = firstDayOfMonth(startDate); month <= asOf; month = addMonths(month, 1)) {
    const key = monthKey(month);
    expenses.push({ expenseDate: month, category: 'Personel', amount: payroll, regionId: null, description: `${key} maaş ödemeleri` });
    for (const region of REGIONS) {
      expenses.push({
        expenseDate: month,
        category: 'Kira',
        amount: WAREHOUSE_RENT[region.id]!,
        regionId: region.id,
        description: `${region.name} depo kirası`,
      });
    }
    expenses.push({ expenseDate: month, category: 'Enerji', amount: round(rng.between(52_000, 68_000)), regionId: null, description: 'Elektrik, su, doğalgaz' });
    expenses.push({ expenseDate: month, category: 'Pazarlama', amount: round(rng.between(55_000, 85_000)), regionId: null, description: 'Kampanya ve bayi teşvikleri' });
    expenses.push({ expenseDate: month, category: 'Genel Yönetim', amount: round(rng.between(30_000, 40_000)), regionId: null, description: 'Muhasebe, yazılım, sigorta' });

    // Lojistik gideri ayın cirosuna bağlıdır; ay sonunda (veya bugün) kaydedilir.
    const monthEnd = lastDayOfMonth(month) < asOf ? lastDayOfMonth(month) : asOf;
    const logistics = (revenueByMonth.get(key) ?? 0) * LOGISTICS_COST_SHARE;
    if (logistics > 0) {
      expenses.push({ expenseDate: monthEnd, category: 'Lojistik', amount: round(logistics), regionId: null, description: 'Sevkiyat ve nakliye' });
    }
  }
  return expenses;
}

export async function seedDatabase(db: DbClient, options: SeedOptions = {}): Promise<SeedSummary> {
  const asOf = options.asOf ?? todayIso();
  const months = options.months ?? 6;
  const rng = createRng(options.randomSeed ?? DEFAULT_RANDOM_SEED);
  const startDate = addDays(asOf, -Math.round(months * 30.4));

  const customers = buildCustomerProfiles(rng, asOf, startDate);
  const orders = generateOrders(rng, customers, startDate, asOf);
  const inventory = generateInventory(rng, orders, asOf);
  const expenses = generateExpenses(rng, orders, startDate, asOf);

  await resetSchema(db);

  let orderItemCount = 0;
  let deliveredRevenue = 0;

  await db.transaction(async (tx) => {
    for (const r of REGIONS) {
      await tx.execute('INSERT INTO regions (id, name) VALUES (?, ?)', [r.id, r.name]);
    }
    for (const p of PRODUCTS) {
      await tx.execute(
        'INSERT INTO products (id, sku, name, category, unit_cost, list_price) VALUES (?, ?, ?, ?, ?, ?)',
        [p.id, p.sku, p.name, p.category, p.unitCost, p.listPrice],
      );
    }
    for (const e of EMPLOYEES) {
      await tx.execute(
        'INSERT INTO employees (id, full_name, role, region_id, monthly_salary, hire_date) VALUES (?, ?, ?, ?, ?, ?)',
        [e.id, e.fullName, e.role, e.regionId, e.monthlySalary, e.hireDate],
      );
    }
    for (const c of customers) {
      await tx.execute(
        'INSERT INTO customers (id, name, customer_type, region_id, sales_rep_id, created_at) VALUES (?, ?, ?, ?, ?, ?)',
        [c.id, c.name, c.customerType, c.regionId, c.salesRepId, c.createdAt],
      );
    }

    let orderId = 0;
    for (const order of orders) {
      orderId += 1;
      await tx.execute(
        'INSERT INTO orders (id, customer_id, region_id, sales_rep_id, order_date, status, order_no) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [orderId, order.customerId, order.regionId, order.salesRepId, order.orderDate, order.status, `S-${orderId}`],
      );
      for (const item of order.items) {
        orderItemCount += 1;
        await tx.execute(
          'INSERT INTO order_items (id, order_id, product_id, quantity, unit_price) VALUES (?, ?, ?, ?, ?)',
          [orderItemCount, orderId, item.productId, item.quantity, item.unitPrice],
        );
        if (order.status === 'delivered') deliveredRevenue += item.quantity * item.unitPrice;
      }
    }

    for (const row of inventory) {
      await tx.execute(
        'INSERT INTO inventory (product_id, region_id, quantity, updated_at) VALUES (?, ?, ?, ?)',
        [row.productId, row.regionId, row.quantity, asOf],
      );
    }

    let expenseId = 0;
    for (const e of expenses) {
      expenseId += 1;
      await tx.execute(
        'INSERT INTO expenses (id, expense_date, category, amount, region_id, description) VALUES (?, ?, ?, ?, ?, ?)',
        [expenseId, e.expenseDate, e.category, e.amount, e.regionId, e.description],
      );
    }
  });

  return {
    asOf,
    startDate,
    regions: REGIONS.length,
    products: PRODUCTS.length,
    employees: EMPLOYEES.length,
    customers: customers.length,
    orders: orders.length,
    orderItems: orderItemCount,
    inventoryRows: inventory.length,
    expenses: expenses.length,
    deliveredRevenue: round(deliveredRevenue),
  };
}
