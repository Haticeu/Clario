import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { describe, it } from 'node:test';
import ExcelJS from 'exceljs';
import { buildAnalysisContext } from '../src/analysis/context.js';
import { getSegmentAnalysis } from '../src/analysis/segments.js';
import { createTestApp } from './helpers.js';
import { askAssistant } from '../src/assistant/index.js';
import { openDatabase } from '../src/db/index.js';
import { runImport } from '../src/import/importer.js';
import { analyzeGrids, parseUpload, readGrids } from '../src/import/mapping.js';

/**
 * Proje bazlı çalışan bir hizmet işletmesi: ürün maliyeti yok, maliyetler proje giderleri olarak girilmiş.
 * Proje yalnızca siparişin ilk satırında yazılı (gruplanmış tablo).
 */
async function projectWorkbook(): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sales = workbook.addWorksheet('Satışlar');
  sales.addRow(['Fatura No', 'Tarih', 'Müşteri', 'Hizmet', 'Tutar', 'Bölüm', 'Proje Adı']);
  sales.addRow(['F-1', '05.09.2026', 'Kuzey AŞ', 'Kurulum', 40_000, 'Kurumsal', 'Merkez Ofis']);
  sales.addRow(['F-1', '05.09.2026', 'Kuzey AŞ', 'Eğitim', 10_000, null, null]);
  sales.addRow(['F-2', '12.09.2026', 'Güney Ltd', 'Kurulum', 20_000, 'KOBİ', 'Depo Otomasyonu']);
  sales.addRow(['F-3', '20.09.2026', 'Batı AŞ', 'Danışmanlık', 5_000, null, null]);

  const expenses = workbook.addWorksheet('Masraflar');
  expenses.addRow(['Tarih', 'Tutar', 'Departman', 'Proje']);
  expenses.addRow(['10.09.2026', 15_000, 'Kurumsal', 'Merkez Ofis']);
  expenses.addRow(['15.09.2026', 26_000, 'KOBİ', 'Depo Otomasyonu']);
  expenses.addRow(['16.09.2026', 3_000, null, null]);
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

async function importedDb() {
  const db = await openDatabase(':memory:');
  const report = await runImport(db, await parseUpload(await projectWorkbook()), { mode: 'merge', commit: true });
  assert.equal(report.ok, true, JSON.stringify(report.errors));
  return db;
}

describe('departman ve proje', () => {
  it('Excel sütunları tanınır; gider türü girilmese de giderler yüklenir', async () => {
    const analysis = analyzeGrids(await readGrids(await projectWorkbook()));
    const sales = analysis.find((s) => s.name === 'Satışlar')!;
    assert.equal(sales.suggestions.sales?.['5'], 'department');
    assert.equal(sales.suggestions.sales?.['6'], 'project');
    const expenses = analysis.find((s) => s.name === 'Masraflar')!;
    assert.equal(expenses.type, 'expenses');

    const db = await importedDb();
    const rows = await db.query<{ category: string; department: string | null }>('SELECT category, department FROM expenses ORDER BY id');
    assert.deepEqual(rows.map((r) => r.category), ['Genel', 'Genel', 'Genel']);
    const orders = await db.query<{ orderNo: string; project: string | null }>('SELECT order_no AS "orderNo", project FROM orders ORDER BY id');
    assert.deepEqual(orders.map((o) => `${o.orderNo}:${o.project}`), ['F-1:Merkez Ofis', 'F-2:Depo Otomasyonu', 'F-3:null']);
    await db.close();
  });

  it('net katkı = ciro − ürün maliyeti − giderler; zarar eden proje uyarılır', async () => {
    const db = await importedDb();
    const analysis = await getSegmentAnalysis(db, buildAnalysisContext('2026-09-25'));

    const project = (name: string | null) => analysis.projects.find((p) => p.name === name)!;
    assert.deepEqual(
      analysis.projects.map((p) => p.name),
      ['Merkez Ofis', 'Depo Otomasyonu', null],
      'toplam ciroya göre sıralı, atanmamış en sonda',
    );
    assert.equal(project('Merkez Ofis').current.revenue, 50_000);
    assert.equal(project('Merkez Ofis').current.net, 35_000);
    assert.equal(project('Depo Otomasyonu').current.net, -6_000);
    assert.equal(project(null).current.net, 2_000);
    assert.equal(project('Merkez Ofis').current.costCoverage, 0, 'ürün maliyeti bilinmiyor');

    assert.deepEqual(
      analysis.alerts.map((a) => `${a.dimension}:${a.name}:${a.severity}`),
      ['department:KOBİ:high', 'project:Depo Otomasyonu:high'],
    );
    assert.match(analysis.alerts[1]!.message, /Depo Otomasyonu projesi son 30 günde ₺6\.000 zarar etti/);
    assert.equal(analysis.coverage.projects.count, 2);
    assert.equal(analysis.coverage.projects.revenueShare, 0.9333);

    const answer = await askAssistant(db, 'Hangi proje zarar ediyor?');
    assert.equal(answer.intent, 'segments');
    assert.match(answer.answer, /Projeler/);
    assert.doesNotMatch(answer.answer, /Departmanlar/);
    assert.match(answer.answer, /Depo Otomasyonu/);
    await db.close();
  });

  it('elle girişte departman/proje kaydedilir ve sonradan değiştirilebilir', async () => {
    const db = await importedDb();
    const server = createTestApp(db).listen(0);
    await new Promise<void>((resolve) => server.once('listening', resolve));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
    const send = (method: string, path: string, body: unknown) =>
      fetch(base + path, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    try {
      const expense = await send('POST', '/data/expenses', { expenseDate: '2026-09-20', amount: 500, department: 'Yönetim', project: 'Merkez Ofis' });
      assert.equal(expense.status, 201);
      const { items: expenses } = (await (await fetch(`${base}/data/expenses`)).json()) as { items: { department: string; project: string; category: string }[] };
      assert.deepEqual([expenses[0]!.department, expenses[0]!.project, expenses[0]!.category], ['Yönetim', 'Merkez Ofis', 'Genel']);

      const { items: orders } = (await (await fetch(`${base}/data/orders`)).json()) as { items: { id: number; orderNo: string; project: string | null }[] };
      const f3 = orders.find((o) => o.orderNo === 'F-3')!;
      assert.equal((await send('PATCH', `/data/orders/${f3.id}`, { project: 'Merkez Ofis' })).status, 204);
      assert.equal((await send('PATCH', `/data/orders/${f3.id}`, {})).status, 400);

      const segments = (await (await fetch(`${base}/segments`)).json()) as { projects: { name: string | null; current: { revenue: number } }[] };
      assert.equal(segments.projects.find((p) => p.name === 'Merkez Ofis')!.current.revenue, 55_000);
      assert.equal(segments.projects.some((p) => p.name === null && p.current.revenue > 0), false);
    } finally {
      server.close();
      await db.close();
    }
  });
});
