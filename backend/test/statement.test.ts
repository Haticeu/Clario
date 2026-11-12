import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { after, before, describe, it } from 'node:test';
import ExcelJS from 'exceljs';
import { getReportNotices, type Statement } from '../src/analysis/statement.js';
import type { DbClient } from '../src/db/types.js';
import { createSeededDb, createTestApp } from './helpers.js';

describe('ekstre ve raporlar', () => {
  let db: DbClient;
  let server: ReturnType<ReturnType<typeof createTestApp>['listen']>;
  let baseUrl: string;
  const get = async (query: string) => fetch(`${baseUrl}/statements?${query}`);

  before(async () => {
    ({ db } = await createSeededDb());
    server = createTestApp(db).listen(0);
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
  });
  after(async () => {
    server.close();
    await db.close();
  });

  it('aylık ekstre: ayın tamamı, günlük döküm, işlemler ve öne çıkanlar', async () => {
    const s = (await (await get('kind=monthly&month=2026-05')).json()) as Statement;
    assert.equal(s.title, 'Mayıs 2026 ekstresi');
    assert.deepEqual([s.period.from, s.period.to], ['2026-05-01', '2026-05-31']);
    assert.ok(s.totals.revenue > 0 && s.totals.orders > 0);
    assert.equal(s.days.length, 31);
    const dayTotal = s.days.reduce((sum, d) => sum + d.revenue, 0);
    assert.ok(Math.abs(dayTotal - s.totals.revenue) <= s.days.length * 0.5); // günlük tutarlar tam sayıya yuvarlı
    assert.ok(s.orders.length > 0 && s.orders.length === Math.min(s.ordersTotal, 1000));
    assert.ok(s.highlights.length >= 3);
    assert.ok(s.expenses > 0);
  });

  it('gün sonu ve tarih aralığı; uzun aralıkta da gün gün döküm', async () => {
    const daily = (await (await get('kind=daily&date=2026-06-15')).json()) as Statement;
    assert.equal(daily.days.length, 1);
    assert.equal(daily.period.days, 1);
    const range = (await (await get('kind=range&from=2026-01-01&to=2026-06-30')).json()) as Statement;
    assert.ok(range.days.length > 100);
  });

  it('geçersiz istekler 400', async () => {
    for (const q of ['kind=monthly&month=2026-13', 'kind=daily&date=dun', 'kind=range&from=2026-06-30&to=2026-01-01', 'kind=x']) {
      assert.equal((await get(q)).status, 400, q);
    }
  });

  it('Excel: özet, günlük ve işlemler sayfaları', async () => {
    const response = await fetch(`${baseUrl}/statements/export.xlsx?kind=monthly&month=2026-05`);
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-disposition') ?? '', /Clario-ekstre-2026-05\.xlsx/);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(Buffer.from(await response.arrayBuffer()) as never);
    const names = workbook.worksheets.map((w) => w.name);
    for (const name of ['Özet', 'Günlük', 'Ürünler', 'İşlemler']) assert.ok(names.includes(name), name);
    assert.ok(workbook.getWorksheet('İşlemler')!.rowCount > 10);
  });

  it('bildirimler: ayın 1\'inde geçen ayın ekstresi, ayarlanan saatten sonra gün sonu raporu; kapatılabilir', async () => {
    const notices = await getReportNotices(db, new Date(2026, 6, 1, 9, 0));
    assert.equal(notices.find((n) => n.kind === 'monthly')?.id, 'monthly-2026-06');
    const evening = await getReportNotices(db, new Date(2026, 5, 30, 19, 0));
    assert.ok(evening.some((n) => n.id === 'daily-2026-06-30'));
    const morning = await getReportNotices(db, new Date(2026, 5, 30, 9, 0));
    assert.ok(!morning.some((n) => n.id === 'daily-2026-06-30'));

    const put = await fetch(`${baseUrl}/statements/settings`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ monthly: false, daily: false, dailyHour: 20 }) });
    assert.equal(put.status, 200);
    assert.equal((await getReportNotices(db, new Date(2026, 6, 1, 21, 0))).length, 0);
    const bad = await fetch(`${baseUrl}/statements/settings`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ monthly: true, daily: true, dailyHour: 24 }) });
    assert.equal(bad.status, 400);
  });
});

describe('asistandan rapor isteği', () => {
  it('dönem ve biçim metinden çıkarılır', async () => {
    const { parseStatementRequest } = await import('../src/assistant/statementRequest.js');
    const today = '2026-10-18';
    const q = (text: string) => parseStatementRequest(text, today);
    assert.equal(q('Eylül ayının raporunu istiyorum')?.query, 'kind=monthly&month=2026-09');
    assert.equal(q('Kasım ekstresi')?.query, 'kind=monthly&month=2025-11'); // gelecekteki ay → geçen yıl
    assert.equal(q('geçen ayın ekstresi excel')?.query, 'kind=monthly&month=2026-09');
    assert.deepEqual(q('geçen ayın ekstresi excel')?.formats, ['excel']);
    assert.equal(q('dünün raporu')?.query, 'kind=daily&date=2026-10-17');
    assert.equal(q('bugünkü gün sonu raporu')?.query, 'kind=daily&date=2026-10-18');
    assert.equal(q('15 Ekim gün sonu raporu pdf')?.query, 'kind=daily&date=2026-10-15');
    assert.equal(q('03.09.2026 raporu')?.query, 'kind=daily&date=2026-09-03');
    assert.equal(q('1.9.2026 ile 15.9.2026 arası rapor')?.query, 'kind=range&from=2026-09-01&to=2026-09-15');
    assert.equal(q('son 7 günün raporu')?.query, 'kind=range&from=2026-10-12&to=2026-10-18');
    assert.equal(q('ekstre')?.query, 'kind=monthly&month=2026-09');
    assert.deepEqual(q('dünün raporu')?.formats, ['pdf', 'word']);
    // Rapor isteği olmayanlar
    assert.equal(q('Bu ay neden satışlar düştü?'), null);
    assert.equal(q('Dünya piyasaları risk raporu'), null);
    assert.equal(q('Hangi müşterileri kaybediyoruz?'), null);
  });

  it('asistan özeti ve indirme seçeneklerini döner', async () => {
    const { askAssistant } = await import('../src/assistant/index.js');
    const { db } = await createSeededDb();
    const response = await askAssistant(db, 'Mayıs 2026 ekstresini istiyorum');
    assert.equal(response.intent, 'statement');
    assert.match(response.answer, /Mayıs 2026 ekstresi hazır/);
    const data = response.data as { statement: { query: string; formats: string[] } };
    assert.equal(data.statement.query, 'kind=monthly&month=2026-05');
    assert.deepEqual(data.statement.formats, ['excel', 'pdf']);
    await db.close();
  });
});
