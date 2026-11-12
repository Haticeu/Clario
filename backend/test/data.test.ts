import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, describe, it } from 'node:test';
import ExcelJS from 'exceljs';
import { createTestApp } from './helpers.js';
import { detectCustomerChurn, detectOpportunities, detectRisks } from '../src/analytics.js';
import { buildAnalysisContext } from '../src/analysis/context.js';
import { openDatabase, type DbClient } from '../src/db/index.js';
import { runImport } from '../src/import/importer.js';
import { parseUpload } from '../src/import/mapping.js';
import { buildExport, buildTemplate } from '../src/import/workbook.js';
import { getRecordCounts } from '../src/repositories/catalogRepository.js';
import { createSeededDb, TEST_AS_OF } from './helpers.js';

async function startServer(db: DbClient): Promise<{ server: Server; baseUrl: string }> {
  const server = createTestApp(db).listen(0);
  await new Promise<void>((resolve) => server.once('listening', resolve));
  return { server, baseUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}/api` };
}

async function json(response: Response) {
  return (await response.json()) as Record<string, unknown> & { error?: { message: string } };
}

describe('uygulama içinden veri girişi', () => {
  let db: DbClient;
  let server: Server;
  let baseUrl: string;
  const post = (path: string, body: unknown) =>
    fetch(baseUrl + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

  before(async () => {
    db = await openDatabase(':memory:');
    ({ server, baseUrl } = await startServer(db));
  });
  after(async () => {
    server.close();
    await db.close();
  });

  it('boş sistemde kayıt ekleyip ilk satışla analizleri açar', async () => {
    const region = await json(await post('/data/regions', { name: 'İzmir' }));
    const product = await json(
      await post('/data/products', { sku: 'A-1', name: 'Ürün A', category: 'Genel', unitCost: '80', listPrice: '1.250,50' }),
    );
    const customer = await json(await post('/data/customers', { name: 'Ege Market', customerType: 'mağaza', regionId: region.id }));

    const order = await post('/data/orders', {
      orderDate: '25.09.2026',
      customerId: customer.id,
      items: [{ productId: product.id, quantity: 3 }],
    });
    assert.equal(order.status, 201);
    assert.equal((await json(order)).orderNo, 'S-1');

    const orders = (await json(await fetch(`${baseUrl}/data/orders`))) as { total: number; items: { totalAmount: number }[] };
    assert.equal(orders.total, 1);
    assert.equal(orders.items[0]!.totalAmount, 3751.5); // liste fiyatı "1.250,50" × 3

    assert.equal((await fetch(`${baseUrl}/dashboard/summary`)).status, 200);
  });

  it('aynı adla ikinci bölge 409, geçersiz sayı 400 ve anlaşılır mesaj döner', async () => {
    const duplicate = await post('/data/regions', { name: 'izmir' });
    assert.equal(duplicate.status, 409);
    assert.match((await json(duplicate)).error!.message, /zaten var/);

    const invalid = await post('/data/products', { sku: 'B-1', name: 'B', category: 'Genel', unitCost: 'abc', listPrice: 5 });
    assert.equal(invalid.status, 400);
    assert.match((await json(invalid)).error!.message, /Birim maliyet geçerli bir sayı değil/);

    const empty = await post('/data/orders', { orderDate: '2026-09-25', customerId: 1, items: [] });
    assert.equal(empty.status, 400);
  });

  it('satışı olan ürün ve siparişi olan müşteri silinemez', async () => {
    const product = await fetch(`${baseUrl}/data/products/1`, { method: 'DELETE' });
    assert.equal(product.status, 409);
    assert.match((await json(product)).error!.message, /satış kaleminde kullanıldığı için silinemez/);
    assert.equal((await fetch(`${baseUrl}/data/customers/1`, { method: 'DELETE' })).status, 409);
  });

  it('stok toplu olarak yazılır ve güncellenir', async () => {
    const put = (quantity: number) =>
      fetch(`${baseUrl}/data/inventory`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify([{ productId: 1, regionId: 1, quantity }]),
      });
    assert.equal((await put(40)).status, 200);
    assert.equal((await put(25)).status, 200);
    const items = (await json(await fetch(`${baseUrl}/data/inventory`))).items as { quantity: number }[];
    assert.deepEqual(items.map((i) => i.quantity), [25]);
  });
});

describe('Excel ile içe/dışa aktarma', () => {
  let source: DbClient;

  before(async () => {
    ({ db: source } = await createSeededDb());
  });
  after(async () => {
    await source.close();
  });

  it('boş şablon okunabilir ve 8 veri sayfası (Tahsilatlar dahil) içerir', async () => {
    const sheets = await parseUpload(await buildTemplate());
    assert.equal(sheets.length, 8);
    const target = await openDatabase(':memory:');
    const report = await runImport(target, sheets, { mode: 'merge', commit: true });
    assert.equal(report.ok, true);
    assert.equal(report.counts.orders.created, 0);
    await target.close();
  });

  it('dışa aktarılan veri boş bir sisteme yüklenince analizler birebir aynı çıkar', async () => {
    const target = await openDatabase(':memory:');
    const report = await runImport(target, await parseUpload(await buildExport(source)), { mode: 'replace', commit: true });
    assert.equal(report.ok, true, JSON.stringify(report.errors));
    assert.equal(report.committed, true);

    const [a, b] = await Promise.all([getRecordCounts(source), getRecordCounts(target)]);
    assert.deepEqual(b, a);

    const ctx = buildAnalysisContext(TEST_AS_OF);
    const skus = async (db: DbClient) => (await detectRisks(db, ctx)).map((r) => `${r.product.sku}:${r.signals.join('+')}`);
    assert.deepEqual(await skus(target), await skus(source));
    const opportunity = async (db: DbClient) => (await detectOpportunities(db, ctx)).map((o) => `${o.product.sku}@${o.region.name}`).sort();
    assert.deepEqual(await opportunity(target), await opportunity(source));
    const churn = async (db: DbClient) => (await detectCustomerChurn(db, ctx)).map((c) => c.customer.name).sort();
    assert.deepEqual(await churn(target), await churn(source));
    await target.close();
  });

  it('aynı dosya tekrar yüklenince kayıtlar çoğalmaz, güncellenir', async () => {
    const target = await openDatabase(':memory:');
    const file = await buildExport(source);
    await runImport(target, await parseUpload(file), { mode: 'merge', commit: true });
    const second = await runImport(target, await parseUpload(file), { mode: 'merge', commit: true });

    assert.equal(second.counts.orders.created, 0);
    assert.ok(second.counts.orders.updated > 0);
    assert.equal(second.counts.products.created, 0);
    assert.equal(second.counts.expenses.created, 0);
    assert.deepEqual(await getRecordCounts(target), await getRecordCounts(source));
    await target.close();
  });

  it('hatalı satırlar sayfa ve satır numarasıyla raporlanır, hiçbir şey kaydedilmez', async () => {
    const workbook = new ExcelJS.Workbook();
    workbook.addWorksheet('Ürünler').addRows([
      ['Ürün Kodu (SKU) *', 'Ürün Adı *', 'Kategori *', 'Birim Maliyet (₺) *', 'Liste Fiyatı (₺) *'],
      ['X-1', 'Ürün X', 'Genel', 10, 15],
    ]);
    workbook.addWorksheet('Müşteriler').addRows([
      ['Müşteri Adı *', 'Tip *', 'Bölge *'],
      ['Test Bayi', 'Bayi', 'Ankara'],
    ]);
    workbook.addWorksheet('Satışlar').addRows([
      ['Tarih *', 'Müşteri *', 'Ürün Kodu (SKU) *', 'Adet *'],
      ['01.09.2026', 'Test Bayi', 'X-1', 5],
      ['31.02.2026', 'Test Bayi', 'X-1', 5],
      ['02.09.2026', 'Test Bayi', 'YOK-9', 1],
      ['03.09.2026', 'Bilinmeyen', 'X-1', 0],
    ]);
    const buffer = Buffer.from(await workbook.xlsx.writeBuffer());

    const target = await openDatabase(':memory:');
    const { server, baseUrl } = await startServer(target);
    try {
      const upload = (query: string) =>
        fetch(`${baseUrl}/import?${query}`, { method: 'POST', headers: { 'content-type': 'application/octet-stream' }, body: buffer });

      const check = await upload('mode=merge&dryRun=true');
      assert.equal(check.status, 200);
      const report = (await check.json()) as { ok: boolean; errors: { sheet: string; row: number; message: string }[]; warnings: unknown[] };
      assert.equal(report.ok, false);
      assert.deepEqual(
        report.errors.map((e) => `${e.sheet}:${e.row}`),
        ['Satışlar:3', 'Satışlar:4'],
      );
      assert.match(report.errors[0]!.message, /geçerli bir tarih değil/);
      assert.match(report.errors[1]!.message, /"YOK-9" için birim fiyat veya tutar gerekli/);
      // Sıfır adetli satır hata değil, iade/düzeltme olarak atlanır; hatalı satırlar otomatik kayıt oluşturmaz
      assert.deepEqual(
        (report.warnings as { message: string }[]).map((w) => w.message.slice(0, 24)).sort(),
        ['"Ankara" bölgesi otomati', '1 satış satırı eksi veya'].sort(),
      );

      const commit = await upload('mode=merge');
      assert.equal(commit.status, 422);
      assert.equal((await getRecordCounts(target)).products, 0);
    } finally {
      server.close();
      await target.close();
    }
  });

  it('Excel/CSV olmayan dosya anlaşılır bir hatayla reddedilir', async () => {
    const target = await openDatabase(':memory:');
    const { server, baseUrl } = await startServer(target);
    try {
      const response = await fetch(`${baseUrl}/import?dryRun=true`, { method: 'POST', body: new Uint8Array([0, 1, 2, 3, 0, 5]) });
      assert.equal(response.status, 400);
      assert.match(((await response.json()) as { error: { message: string } }).error.message, /\.xlsx/);
    } finally {
      server.close();
      await target.close();
    }
  });
});
