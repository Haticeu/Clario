import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, describe, it } from 'node:test';
import { createTestApp } from './helpers.js';
import type { CurrencyCode } from '../src/currency/currencies.js';
import { identityMoney, resolveMoney, runWithMoney } from '../src/currency/money.js';
import { fillDaily, type RateProvider, type RateSeries } from '../src/currency/rates.js';
import type { DbClient } from '../src/db/index.js';
import { openDatabase } from '../src/db/index.js';
import { getDailySales } from '../src/repositories/salesRepository.js';
import { addDays, parseIsoDate } from '../src/utils/dates.js';
import { createSeededDb, TEST_AS_OF } from './helpers.js';

/** 1 EUR karşılığı TRY zamanla artar (lira değer kaybeder); USD ve GBP sabit. */
function tryPerEur(date: string): number {
  return 40 + (parseIsoDate(date).getTime() - Date.UTC(2025, 0, 1)) / 86_400_000 / 20;
}

/** Hafta sonu kur yayımlamayan sahte kaynak; kaç kez çağrıldığını sayar. */
function fakeProvider(): RateProvider & { calls: number } {
  return {
    source: 'Test kurları',
    calls: 0,
    async fetchRates(from, to) {
      this.calls++;
      const series: RateSeries = new Map();
      for (let day = from; day <= to; day = addDays(day, 1)) {
        const weekday = parseIsoDate(day).getUTCDay();
        if (weekday === 0 || weekday === 6) continue;
        series.set(day, { EUR: 1, TRY: tryPerEur(day), USD: 1.1, GBP: 0.85 });
      }
      return series;
    },
  };
}

const failingProvider: RateProvider = {
  source: 'Ulaşılamayan kaynak',
  fetchRates: () => Promise.reject(new Error('ağ yok')),
};

async function startServer(db: DbClient, rateProvider: RateProvider) {
  const server = createTestApp(db, { rateProvider }).listen(0);
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const { port } = server.address() as AddressInfo;
  return { server, baseUrl: `http://127.0.0.1:${port}/api` };
}

async function getJson<T>(url: string, currency?: CurrencyCode): Promise<T> {
  const response = await fetch(url, { headers: currency ? { 'X-Clario-Currency': currency } : {} });
  assert.equal(response.status, 200, await response.clone().text());
  return (await response.json()) as T;
}

describe('kur serisi', () => {
  it('hafta sonu ve tatiller önceki iş gününün kuruyla, serinin başından önceki günler ilk kurla doldurulur', () => {
    const series: RateSeries = new Map([
      ['2026-09-04', { TRY: 50 }], // cuma
      ['2026-09-07', { TRY: 51 }], // pazartesi
    ]);
    assert.deepEqual(fillDaily(series, '2026-09-02'), [
      ['2026-09-02', { TRY: 50 }],
      ['2026-09-03', { TRY: 50 }],
      ['2026-09-04', { TRY: 50 }],
      ['2026-09-05', { TRY: 50 }],
      ['2026-09-06', { TRY: 50 }],
      ['2026-09-07', { TRY: 51 }],
    ]);
  });
});

describe('para birimi çevrimi', () => {
  let db: DbClient;
  let server: Server;
  let baseUrl: string;
  let provider: ReturnType<typeof fakeProvider>;

  before(async () => {
    ({ db } = await createSeededDb());
    provider = fakeProvider();
    ({ server, baseUrl } = await startServer(db, provider));
  });
  after(async () => {
    server.close();
    await db.close();
  });

  it('eşzamanlı istekler kurları tek seferde çeker', async () => {
    await Promise.all(['/risks', '/margins', '/dashboard/summary'].map((path) => getJson(baseUrl + path, 'USD')));
    assert.equal(provider.calls, 1);
    await getJson(`${baseUrl}/sales/analytics`, 'EUR');
    assert.equal(provider.calls, 1, 'kurlar veritabanında; tekrar çekilmez');
  });

  it('her günün cirosu o günün kuruyla çevrilir', async () => {
    const window = { from: addDays(TEST_AS_OF, -60), to: TEST_AS_OF };
    const inTry = await getDailySales(db, window);
    const usd = await resolveMoney(db, provider, 'TRY', 'USD');
    const inUsd = await runWithMoney(usd, () => getDailySales(db, window));

    assert.equal(inUsd.length, inTry.length);
    for (const [i, row] of inTry.entries()) {
      // Siparişler hafta sonu da olabilir: hafta sonu, cuma kuruyla çevrilir
      let rateDay = row.date;
      while ([0, 6].includes(parseIsoDate(rateDay).getUTCDay())) rateDay = addDays(rateDay, -1);
      const expected = (row.revenue * 1.1) / tryPerEur(rateDay);
      assert.ok(Math.abs(inUsd[i]!.revenue - expected) < 0.01, `${row.date}: ${inUsd[i]!.revenue} ≠ ${expected}`);
    }
  });

  it('ciro çevrilir, marj oranları ve adetler para biriminden bağımsız kalır', async () => {
    type Sales = { totals: { current: { revenue: number; units: number; grossMarginPct: number } } };
    type Margins = { items: { product: { sku: string }; marginPct: number; avgDiscountPct: number }[] };
    const [tryDash, usdDash, tryMargins, usdMargins] = await Promise.all([
      getJson<Sales>(`${baseUrl}/sales/analytics`),
      getJson<Sales>(`${baseUrl}/sales/analytics`, 'USD'),
      getJson<Margins>(`${baseUrl}/margins`),
      getJson<Margins>(`${baseUrl}/margins`, 'USD'),
    ]);
    const ratio = usdDash.totals.current.revenue / tryDash.totals.current.revenue;
    assert.ok(ratio > 1.1 / tryPerEur(TEST_AS_OF) && ratio < 1.1 / tryPerEur(addDays(TEST_AS_OF, -31)), `oran: ${ratio}`);
    assert.equal(usdDash.totals.current.units, tryDash.totals.current.units);
    assert.ok(Math.abs(usdDash.totals.current.grossMarginPct - tryDash.totals.current.grossMarginPct) < 0.001);

    const tryBySku = new Map(tryMargins.items.map((m) => [m.product.sku, m]));
    for (const item of usdMargins.items) {
      const inTry = tryBySku.get(item.product.sku)!;
      assert.ok(Math.abs(item.marginPct - inTry.marginPct) < 0.001, item.product.sku);
      assert.ok(Math.abs(item.avgDiscountPct - inTry.avgDiscountPct) < 0.001, item.product.sku);
    }
  });

  it('asistan cevapları gösterim para biriminin simgesini kullanır', async () => {
    const response = await fetch(`${baseUrl}/assistant/ask`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Clario-Currency': 'USD' },
      body: JSON.stringify({ question: 'Genel durum nasıl?' }),
    });
    const { answer } = (await response.json()) as { answer: string };
    assert.match(answer, /\$/);
    assert.doesNotMatch(answer, /₺/);
  });

  it('kullanılan kuru bildirir; desteklenmeyen para birimi 400 döner', async () => {
    const info = await getJson<{ base: string; display: string; rate: number; rateDate: string; source: string }>(`${baseUrl}/currency`, 'USD');
    assert.equal(info.base, 'TRY');
    assert.equal(info.display, 'USD');
    assert.equal(info.source, 'Test kurları');
    assert.ok(info.rate > 0 && info.rate < 0.05);
    assert.equal((await fetch(`${baseUrl}/risks?currency=XYZ`)).status, 400);
  });

  it('veri girişi her zaman ana para biriminde kalır; ana para birimi ayarlanabilir', async () => {
    type Products = { items: { sku: string; unitCost: number }[] };
    const plain = await getJson<Products>(`${baseUrl}/data/products`);
    const withHeader = await getJson<Products>(`${baseUrl}/data/products`, 'USD');
    assert.deepEqual(withHeader, plain);

    const put = async (baseCurrency: string) =>
      fetch(`${baseUrl}/settings`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ baseCurrency }) });
    assert.equal((await put('XYZ')).status, 400);
    assert.equal((await put('EUR')).status, 200);
    try {
      const settings = await getJson<{ baseCurrency: string }>(`${baseUrl}/settings`);
      assert.equal(settings.baseCurrency, 'EUR');
      // Veriler artık EUR kabul edilir: para birimi istenmezse çevrim yapılmaz
      const info = await getJson<{ base: string; display: string; rate: number }>(`${baseUrl}/currency`);
      assert.deepEqual([info.base, info.display, info.rate], ['EUR', 'EUR', 1]);
    } finally {
      await put('TRY');
    }
  });
});

describe('kur kaynağına ulaşılamazsa', () => {
  it('çevrim istenen analizler 502 ile açıklama döner, ana para birimi çalışmaya devam eder', async () => {
    const { db } = await createSeededDb();
    const { server, baseUrl } = await startServer(db, failingProvider);
    try {
      const response = await fetch(`${baseUrl}/dashboard/summary`, { headers: { 'X-Clario-Currency': 'USD' } });
      assert.equal(response.status, 502);
      const body = (await response.json()) as { error: { message: string } };
      assert.match(body.error.message, /kurları alınamadı/);
      assert.equal((await fetch(`${baseUrl}/dashboard/summary`)).status, 200);
    } finally {
      server.close();
      await db.close();
    }
  });

  it('istek dışında (betikler) çevrim yapılmaz', async () => {
    const db = await openDatabase(':memory:');
    const rows = await runWithMoney(identityMoney('TRY'), () => getDailySales(db, { from: '2026-01-01', to: '2026-02-01' }));
    assert.deepEqual(rows, []);
    await db.close();
  });
});
