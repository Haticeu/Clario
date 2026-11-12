import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { after, before, describe, it } from 'node:test';
import type { OrderDetail, SearchResults } from '../src/analysis/search.js';
import type { DbClient } from '../src/db/types.js';
import { createSeededDb, createTestApp } from './helpers.js';

describe('genel arama', () => {
  let db: DbClient;
  let server: ReturnType<ReturnType<typeof createTestApp>['listen']>;
  let baseUrl: string;
  const find = async (q: string) => (await (await fetch(`${baseUrl}/search?q=${encodeURIComponent(q)}`)).json()) as SearchResults;

  before(async () => {
    ({ db } = await createSeededDb());
    server = createTestApp(db).listen(0);
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
  });
  after(async () => {
    server.close();
    await db.close();
  });

  it('Türkçe harf ve büyük/küçük harf fark etmez; müşterinin özeti ve son işlemleri gelir', async () => {
    const result = await find('kadikoy');
    assert.equal(result.customers.length, 1);
    const customer = result.customers[0]!;
    assert.equal(customer.name, 'Kadıköy Market Zinciri');
    assert.ok(customer.orders > 0 && customer.revenue > 0 && customer.lastOrderDate);
    assert.ok(result.orders.length > 0 && result.orders.every((o) => o.customerId === customer.id));
  });

  it('kelime başından eşleşir: "ist" İstanbul\'u bulur, "Lojistik"i bulmaz', async () => {
    const result = await find('ist');
    assert.deepEqual(result.regions.map((r) => r.name), ['İstanbul']);
    assert.ok(result.expenses.every((e) => e.category !== 'Lojistik'));
    assert.ok(result.expenses.some((e) => e.description === 'İstanbul depo kirası' && e.count > 1));
  });

  it('işlem numarasıyla: tam eşleşen en üstte; "#5" yalnızca işlemlerde arar', async () => {
    assert.equal((await find('S-12')).orders[0]?.orderNo, 'S-12');
    const hash = await find('#5');
    assert.equal(hash.orders[0]?.id, 5);
    assert.equal(hash.products.length + hash.customers.length + hash.expenses.length, 0);
  });

  it('ürün koduyla ve kategoriyle', async () => {
    assert.deepEqual((await find('tmz-00')).products.map((p) => p.sku), ['TMZ-001', 'TMZ-002', 'TMZ-003', 'TMZ-004']);
    assert.ok((await find('hijyen')).categories.some((c) => c.name === 'Hijyen' && c.revenue > 0));
  });

  it('kısa veya eşleşmeyen sorgu boş döner; çok uzun sorgu reddedilir; özel karakterler güvenlidir', async () => {
    assert.equal((await find('a')).total, 0);
    assert.equal((await find("%' OR 1=1 --")).total, 0);
    assert.equal((await fetch(`${baseUrl}/search?q=${'x'.repeat(101)}`)).status, 400);
  });

  it('işlem ayrıntısı: kalemler toplamı işlem tutarına eşittir', async () => {
    const order = (await (await fetch(`${baseUrl}/orders/12`)).json()) as OrderDetail;
    assert.equal(order.orderNo, 'S-12');
    assert.ok(order.lines.length > 0);
    const sum = order.lines.reduce((s, l) => s + l.total, 0);
    assert.ok(Math.abs(sum - order.total) < 0.05);
    assert.equal((await fetch(`${baseUrl}/orders/999999`)).status, 404);
    assert.equal((await fetch(`${baseUrl}/orders/abc`)).status, 404);
  });
});
