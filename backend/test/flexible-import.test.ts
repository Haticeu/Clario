import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { describe, it } from 'node:test';
import ExcelJS from 'exceljs';
import { createTestApp } from './helpers.js';
import { openDatabase } from '../src/db/index.js';
import { runImport } from '../src/import/importer.js';
import { analyzeGrids, parseUpload, readGrids } from '../src/import/mapping.js';
import { getRecordCounts } from '../src/repositories/catalogRepository.js';

/** Kullanıcının kendi hazırladığı gibi bir satış tablosu: farklı başlıklar, üstte başlık yazısı, altta toplam. */
async function userSalesWorkbook(): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Sayfa1');
  sheet.addRow(['2026 Satış Raporu']);
  sheet.addRow([]);
  sheet.addRow(['Satış Tarihi', 'Cari Adı', 'Şehir', 'Ürün', 'Miktar', 'Tutar (TL)']);
  const rows: [Date | string, string, string, string, number, number | string][] = [
    [new Date(Date.UTC(2026, 6, 3)), 'Yıldız Market', 'Bursa', 'Sıvı Sabun 5L', 10, 1320],
    [new Date(Date.UTC(2026, 6, 3)), 'Yıldız Market', 'Bursa', 'Kağıt Havlu', 20, 1780],
    ['15.07.2026', 'Deniz Ticaret', 'İzmir', 'Sıvı Sabun 5L', 5, '660,00'],
    ['2 Ağustos 2026', 'Yıldız Market', 'Bursa', 'Sıvı Sabun 5L', 8, 1056],
    [new Date(Date.UTC(2026, 7, 20)), 'Deniz Ticaret', 'İzmir', 'Kağıt Havlu', 12, '1.068'],
  ];
  for (const row of rows) sheet.addRow(row);
  sheet.addRow(['Genel Toplam', '', '', '', 55, 5884]);
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

describe('kullanıcının kendi tablolarını içe aktarma', () => {
  it('farklı başlıkları ve sayfa adını tanır, başlık satırını bulur', async () => {
    const [analysis] = analyzeGrids(await readGrids(await userSalesWorkbook()));
    assert.equal(analysis!.name, 'Sayfa1');
    assert.equal(analysis!.type, 'sales');
    assert.equal(analysis!.headerRow, 3);
    const mapped = Object.values(analysis!.suggestions.sales).sort();
    assert.deepEqual(mapped, ['customer', 'lineTotal', 'orderDate', 'productName', 'quantity', 'region'].sort());
  });

  it('düz satış tablosundan ürün, müşteri ve bölgeleri oluşturur; fiyatı tutardan hesaplar', async () => {
    const db = await openDatabase(':memory:');
    const report = await runImport(db, await parseUpload(await userSalesWorkbook()), { mode: 'merge', commit: true });
    assert.equal(report.ok, true, JSON.stringify(report.errors));
    assert.equal(report.counts.products.created, 2);
    assert.equal(report.counts.customers.created, 2);
    assert.equal(report.counts.regions.created, 2);
    assert.equal(report.counts.orders.created, 4); // 3 Temmuz'daki iki satır tek sipariş
    assert.ok(report.warnings.some((w) => /Toplam/.test(w.message)), 'toplam satırı atlandı uyarısı');
    assert.ok(report.warnings.some((w) => /maliyeti bilinmiyor/.test(w.message)));

    const prices = await db.query<{ name: string; listPrice: number }>('SELECT name, list_price AS "listPrice" FROM products ORDER BY name');
    assert.deepEqual(prices.map((p) => ({ ...p })), [
      { name: 'Kağıt Havlu', listPrice: 89 },
      { name: 'Sıvı Sabun 5L', listPrice: 132 },
    ]);
    const server = createTestApp(db).listen(0);
    await new Promise<void>((r) => server.once('listening', r));
    try {
      const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
      const dashboard = (await (await fetch(`${base}/dashboard/summary`)).json()) as {
        kpis: { revenue: { current: number }; grossProfit: { current: number | null }; estimatedNetProfit: number | null };
      };
      assert.ok(dashboard.kpis.revenue.current > 0);
      // Maliyet girilmediği için kâr bilinmiyor (yanıltıcı %100 marj yerine)
      assert.equal(dashboard.kpis.grossProfit.current, null);
      assert.equal(dashboard.kpis.estimatedNetProfit, null);
      // Stok girilmediği için sahte "tükenme riski" üretilmez
      const risks = (await (await fetch(`${base}/risks`)).json()) as { items: { signals: string[] }[] };
      assert.ok(risks.items.every((r) => !r.signals.includes('stockout') && !r.signals.includes('overstock')));
      const margins = (await (await fetch(`${base}/margins`)).json()) as { count: number };
      assert.equal(margins.count, 0);
    } finally {
      server.close();
    }

    // Aynı dosya tekrar: çoğalmaz
    const again = await runImport(db, await parseUpload(await userSalesWorkbook()), { mode: 'merge', commit: true });
    assert.equal(again.counts.orders.created, 0);
    assert.equal(again.counts.products.created, 0);
    assert.equal((await getRecordCounts(db)).orders, 4);
    await db.close();
  });

  it('noktalı virgüllü, Türkçe sayı biçimli CSV dosyasını okur', async () => {
    const csv =
      '﻿Tarih;Müşteri;Ürün Kodu;Adet;Birim Fiyat\n' +
      '01.09.2026;Ege Bayi;A-1;3;"1.250,50"\n' +
      '02.09.2026;Ege Bayi;A-1;2;1.250,50\n';
    const db = await openDatabase(':memory:');
    const report = await runImport(db, await parseUpload(Buffer.from(csv, 'utf8')), { mode: 'merge', commit: true });
    assert.equal(report.ok, true, JSON.stringify(report.errors));
    const total = await db.queryOne<{ total: number }>('SELECT SUM(quantity * unit_price) AS total FROM order_items');
    assert.equal(total!.total, 6252.5);
    await db.close();
  });

  it('kullanıcının düzelttiği eşleştirme API üzerinden uygulanır', async () => {
    const db = await openDatabase(':memory:');
    const server = createTestApp(db).listen(0);
    await new Promise<void>((r) => server.once('listening', r));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
    try {
      const file = await userSalesWorkbook();
      const analysis = (await (await fetch(`${base}/import/analyze`, { method: 'POST', body: file })).json()) as {
        sheets: { name: string; type: string; headerRow: number; suggestions: Record<string, Record<string, string>> }[];
      };
      const sheet = analysis.sheets[0]!;
      // Kullanıcı "Şehir" sütununu eşleştirmeden çıkarıyor
      const columns = { ...sheet.suggestions.sales };
      delete columns[Object.keys(columns).find((k) => columns[k] === 'region')!];
      const mapping = { sheets: [{ name: sheet.name, type: 'sales', headerRow: sheet.headerRow, columns }] };

      const response = await fetch(`${base}/import?mode=merge`, {
        method: 'POST',
        headers: { 'x-clario-mapping': encodeURIComponent(JSON.stringify(mapping)) },
        body: file,
      });
      assert.equal(response.status, 200);
      const regions = await db.query<{ name: string }>('SELECT name FROM regions');
      assert.deepEqual(regions.map((r) => r.name), ['Merkez']); // bölge eşleştirilmeyince varsayılan
    } finally {
      server.close();
      await db.close();
    }
  });

  it('gruplanmış tabloyu tamamlar, iadeleri atlar, istenirse hatalı satırları atlayarak içe aktarır', async () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Satış');
    sheet.addRows([
      ['Tarih', 'Müşteri', 'Ürün', 'Adet', 'Tutar'],
      ['01.09.2026', 'Kuzey Market', 'Sabun', 5, 500],
      [null, null, 'Deterjan', 2, 300], // aynı gün + müşteri (gruplanmış)
      ['02.09.2026', 'Güney Bayi', 'Sabun', -1, -100], // iade
      [null, null, 'Deterjan', 'birkaç', 90], // hatalı adet
      ['03.09.2026', 'Güney Bayi', 'Sabun', 3, 300],
      [null, 'Not: fiyatlar KDV hariç', null, null, null], // not satırı
    ]);
    const file = Buffer.from(await workbook.xlsx.writeBuffer());
    const db = await openDatabase(':memory:');

    const strict = await runImport(db, await parseUpload(file), { mode: 'merge', commit: true });
    assert.equal(strict.ok, false);
    assert.equal(strict.rowErrors, 1);
    assert.equal(strict.errors[0]!.row, 5);
    assert.equal((await getRecordCounts(db)).orders, 0);

    const lenient = await runImport(db, await parseUpload(file), { mode: 'merge', commit: true, skipInvalidRows: true });
    assert.equal(lenient.ok, true, JSON.stringify(lenient.errors));
    assert.equal(lenient.skippedRows, 1);
    const messages = lenient.warnings.map((w) => w.message).join(' | ');
    assert.match(messages, /1 satış satırı eksi veya sıfır/);
    assert.match(messages, /üstteki satırdan tamamlandı/);
    assert.match(messages, /1 hatalı satır atlandı/);
    const orders = await db.query<{ customer: string; items: number }>(
      'SELECT c.name AS customer, COUNT(oi.id) AS items FROM orders o JOIN customers c ON c.id = o.customer_id JOIN order_items oi ON oi.order_id = o.id GROUP BY o.id, c.name ORDER BY o.order_date',
    );
    assert.deepEqual(orders.map((o) => `${o.customer}:${o.items}`), ['Kuzey Market:2', 'Güney Bayi:1']);
    await db.close();
  });
});