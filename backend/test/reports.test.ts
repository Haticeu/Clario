import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, describe, it } from 'node:test';
import { bucketStart, granularityFor, previousPeriod } from '../src/analysis/reports.js';
import type { RateProvider, RateSeries } from '../src/currency/rates.js';
import type { DbClient } from '../src/db/index.js';
import { addDays } from '../src/utils/dates.js';
import { createSeededDb, createTestApp, TEST_AS_OF } from './helpers.js';

interface Row {
  key: string | number | null;
  name: string | null;
  revenue: number;
  share: number;
}
interface Report {
  period: { from: string; to: string; days: number };
  previousPeriod: { from: string; to: string };
  totals: { revenue: number; orders: number; customers: number; units: number; grossMarginPct: number | null };
  previousTotals: { revenue: number };
  expenses: number | null;
  series: { granularity: string; points: { start: string; revenue: number }[] };
  breakdowns: Record<string, Row[]>;
  orders: { total: number; items: { id: number; date: string; amount: number }[] };
}

const flatRates: RateProvider = {
  source: 'test',
  async fetchRates(from, to) {
    const series: RateSeries = new Map();
    for (let day = from; day <= to; day = addDays(day, 1)) series.set(day, { EUR: 1, TRY: 50, USD: 1.1, GBP: 0.85 });
    return series;
  },
};

describe('birim: dönem ve dilimler', () => {
  it('önceki dönem aynı uzunlukta ve hemen öncesinde', () => {
    assert.deepEqual(previousPeriod({ from: '2026-03-01', to: '2026-03-31' }), { from: '2026-01-29', to: '2026-02-28' });
  });
  it('grafik aralığı dönem uzunluğuna göre; hafta pazartesi, ay ayın ilk günü başlar', () => {
    assert.deepEqual([granularityFor(31), granularityFor(90), granularityFor(365)], ['day', 'week', 'month']);
    assert.equal(bucketStart('2026-09-27', 'week'), '2026-09-21'); // pazar → o haftanın pazartesisi
    assert.equal(bucketStart('2026-09-21', 'week'), '2026-09-21');
    assert.equal(bucketStart('2026-09-27', 'month'), '2026-09-01');
  });
});

describe('filtrelenebilir rapor', () => {
  let db: DbClient;
  let server: Server;
  let base: string;

  before(async () => {
    ({ db } = await createSeededDb());
    server = createTestApp(db, { rateProvider: flatRates }).listen(0);
    await new Promise<void>((resolve) => server.once('listening', resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
  });
  after(async () => {
    server.close();
    await db.close();
  });

  const report = async (query: Record<string, string | number> = {}, headers: Record<string, string> = {}) => {
    const response = await fetch(`${base}/reports/summary?${new URLSearchParams(Object.entries(query).map(([k, v]) => [k, String(v)]))}`, { headers });
    assert.equal(response.status, 200, await response.clone().text());
    return (await response.json()) as Report;
  };

  /** Rapordan bağımsız, doğrudan SQL ile ciro */
  const revenue = async (where: string, params: (string | number)[]) =>
    (
      await db.queryOne<{ r: number }>(
        `SELECT COALESCE(SUM(oi.quantity * oi.unit_price), 0) AS r
         FROM orders o JOIN order_items oi ON oi.order_id = o.id JOIN products p ON p.id = oi.product_id
         JOIN customers c ON c.id = o.customer_id WHERE ${where}`,
        params,
      )
    )!.r;

  it('filtre seçenekleri: kategoriler, müşteriler, bölgeler ve verinin tarih aralığı', async () => {
    const options = (await (await fetch(`${base}/reports/options`)).json()) as {
      categories: string[];
      customers: unknown[];
      regions: unknown[];
      dataRange: { from: string; to: string };
    };
    assert.ok(options.categories.length >= 3);
    assert.ok(options.customers.length > 10);
    assert.ok(options.regions.length >= 3);
    assert.equal(options.dataRange.to, TEST_AS_OF);
  });

  it('filtresiz: verinin tamamı, teslim edilen siparişler', async () => {
    const r = await report();
    assert.equal(r.period.to, TEST_AS_OF);
    assert.ok(Math.abs(r.totals.revenue - (await revenue("o.status = 'delivered'", []))) < 1);
    assert.equal(r.series.granularity, granularityFor(r.period.days));
  });

  it('ay filtresi: tutarlar SQL ile birebir; önceki eşit dönemle karşılaştırılır; günlük grafik', async () => {
    const r = await report({ from: '2026-05-01', to: '2026-05-31' });
    const expected = await revenue("o.status = 'delivered' AND o.order_date BETWEEN ? AND ?", ['2026-05-01', '2026-05-31']);
    assert.ok(Math.abs(r.totals.revenue - expected) < 1, `${r.totals.revenue} ≠ ${expected}`);
    assert.deepEqual(r.previousPeriod, { from: '2026-03-31', to: '2026-04-30' });
    assert.equal(r.series.granularity, 'day');
    assert.equal(r.series.points.length, 31);
    const seriesSum = r.series.points.reduce((sum, p) => sum + p.revenue, 0);
    assert.ok(Math.abs(seriesSum - r.totals.revenue) < 31, 'grafik toplamı = ciro');
    const shares = r.breakdowns.category!.reduce((sum, row) => sum + row.share, 0);
    assert.ok(Math.abs(shares - 1) < 0.001, 'kategori payları toplamı %100');
  });

  it('kategori, müşteri ve bölge filtreleri birlikte uygulanır', async () => {
    const r0 = await report({ from: '2026-01-01', to: '2026-06-30' });
    const category = r0.breakdowns.category![0]!.name!;
    const r1 = await report({ from: '2026-01-01', to: '2026-06-30', category });
    assert.ok(Math.abs(r1.totals.revenue - (await revenue("o.status = 'delivered' AND o.order_date BETWEEN ? AND ? AND p.category = ?", ['2026-01-01', '2026-06-30', category]))) < 1);
    assert.deepEqual(r1.breakdowns.category!.map((row) => row.name), [category], 'yalnızca seçilen kategori');
    assert.equal(r1.expenses, null, 'ürün filtresi varken gider hesaplanmaz');

    const customerId = Number(r1.breakdowns.customer![0]!.key);
    const byCustomer = await report({ from: '2026-01-01', to: '2026-06-30', category, customerId });
    const regionId = Number(byCustomer.breakdowns.region![0]!.key);
    const r2 = await report({ from: '2026-01-01', to: '2026-06-30', category, customerId, regionId });
    const expected = await revenue(
      "o.status = 'delivered' AND o.order_date BETWEEN ? AND ? AND p.category = ? AND o.customer_id = ? AND o.region_id = ?",
      ['2026-01-01', '2026-06-30', category, customerId, regionId],
    );
    assert.ok(Math.abs(r2.totals.revenue - expected) < 1);
    assert.equal(r2.totals.customers, 1);
  });

  it('durum: iptal edilen siparişler ayrıca listelenebilir', async () => {
    const r = await report({ status: 'cancelled' });
    assert.ok(Math.abs(r.totals.revenue - (await revenue("o.status = 'cancelled'", []))) < 1);
    const all = await report({ status: 'all' });
    const delivered = await report();
    assert.ok(Math.abs(all.totals.revenue - delivered.totals.revenue - r.totals.revenue) < 1);
  });

  it('atanmamış departman/proje filtresi ve gider', async () => {
    const r = await report({ from: '2026-06-01', to: '2026-06-30', department: '__none__' });
    const all = await report({ from: '2026-06-01', to: '2026-06-30' });
    assert.equal(r.totals.revenue, all.totals.revenue, 'test verisinde departman girilmemiş');
    const expenses = (await db.queryOne<{ t: number }>("SELECT SUM(amount) AS t FROM expenses WHERE expense_date BETWEEN '2026-06-01' AND '2026-06-30'"))!.t;
    assert.ok(Math.abs((all.expenses ?? 0) - expenses) < 1);
    const cost = (await db.queryOne<{ c: number }>(
      "SELECT SUM(oi.quantity * p.unit_cost) AS c FROM orders o JOIN order_items oi ON oi.order_id = o.id JOIN products p ON p.id = oi.product_id WHERE o.status = 'delivered' AND o.order_date BETWEEN '2026-06-01' AND '2026-06-30'",
    ))!.c;
    assert.ok(Math.abs((all as Report & { netContribution: number }).netContribution - (all.totals.revenue - cost - expenses)) < 2, 'net katkı = ciro − maliyet − gider');
  });

  it('sipariş listesi sayfalanır', async () => {
    const first = await report({ from: '2026-01-01', to: '2026-06-30' });
    const second = await report({ from: '2026-01-01', to: '2026-06-30', offset: 50 });
    assert.equal(first.orders.items.length, 50);
    assert.ok(first.orders.total > 100);
    assert.ok(first.orders.items[0]!.date >= second.orders.items[0]!.date, 'yeniden eskiye');
    assert.equal(new Set([...first.orders.items, ...second.orders.items].map((o) => o.id)).size, 100);
  });

  it('gösterim para birimine çevrilir', async () => {
    const tl = await report({ from: '2026-06-01', to: '2026-06-30' });
    const usd = await report({ from: '2026-06-01', to: '2026-06-30' }, { 'X-Clario-Currency': 'USD' });
    assert.ok(Math.abs(usd.totals.revenue - (tl.totals.revenue * 1.1) / 50) < 2);
    assert.equal(usd.totals.orders, tl.totals.orders);
  });

  it('geçersiz filtreler 400 döner', async () => {
    for (const query of ['from=2026-06-30&to=2026-06-01', 'from=30.06.2026', 'status=hepsi', 'customerId=abc', 'customerType=Toptan', 'from=1900-01-01&to=2026-01-01']) {
      assert.equal((await fetch(`${base}/reports/summary?${query}`)).status, 400, query);
    }
  });
});
