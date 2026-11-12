import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { describe, it } from 'node:test';
import ExcelJS from 'exceljs';
import { getCustomerLedger, getReceivableNotices, getReceivables } from '../src/analysis/receivables.js';
import { askAssistant } from '../src/assistant/index.js';
import * as data from '../src/data/entities.js';
import { openDatabase } from '../src/db/index.js';
import { createTestApp } from './helpers.js';

const NOW = new Date(2026, 9, 18, 12, 0); // 18.10.2026 (yerel)

/** Küçük bir cari senaryosu: iki müşteri, vadeli faturalar, tahsilatlar, bir tedarikçi borcu */
async function scenario() {
  const db = await openDatabase(':memory:');
  const region = await data.createRegion(db, { name: 'İstanbul' });
  const product = await data.createProduct(db, { sku: 'P1', name: 'Hizmet', category: 'Hizmet', unitCost: 0, listPrice: 1000 });
  const a = await data.createCustomer(db, { name: 'Alfa A.Ş.', customerType: 'Bayi', regionId: region.id, taxId: '1111111111', paymentTermDays: 30, creditLimit: 5000 });
  const b = await data.createCustomer(db, { name: 'Beta Ltd.', customerType: 'Bayi', regionId: region.id });
  const order = (customerId: number, orderDate: string, qty: number, dueDate?: string) =>
    data.createOrder(db, { customerId, orderDate, dueDate, items: [{ productId: product.id, quantity: qty, unitPrice: 1000 }] });
  // Takip başlangıcından önceki fatura hesaba katılmaz
  await order(a.id, '2026-05-01', 9);
  await order(a.id, '2026-07-01', 2); // vade: +30 gün = 31.07 → 79 gün gecikmiş
  await order(a.id, '2026-09-01', 3); // vade 01.10 → 17 gün gecikmiş
  await order(a.id, '2026-10-10', 4, '2026-10-24'); // vadesi gelmemiş (6 gün sonra)
  await order(b.id, '2026-08-01', 1, '2026-08-15');
  // Alfa 2.500 ödedi: önce Temmuz faturası (2.000) kapanır, 500 Eylül faturasına mahsup edilir
  await data.createPayment(db, { customerId: a.id, paymentDate: '2026-08-20', amount: 2500, method: 'Havale/EFT', reference: 'DK-1' });
  await data.createPayment(db, { customerId: b.id, paymentDate: '2026-08-10', amount: 1500, method: 'Nakit' }); // fazla ödeme: avans
  await data.createExpense(db, { expenseDate: '2026-10-01', category: 'Alış faturası', amount: 1000, invoiceTotal: 1200, supplier: 'Tedarik Ltd.', dueDate: '2026-10-20', invoiceNo: 'T-1' });
  await data.createExpense(db, { expenseDate: '2026-09-01', category: 'Kira', amount: 500 }); // tedarikçisiz gider: borç sayılmaz
  return { db, a, b };
}

describe('cari hesap ve alacak takibi', () => {
  it('takip başlatılmadan alacak hesaplanmaz (geçmiş satışlar borç sayılmaz)', async () => {
    const { db } = await scenario();
    const report = await getReceivables(db, NOW);
    assert.equal(report.setupRequired, true);
    assert.equal(report.summary.totalReceivable, 0);
    assert.deepEqual(await getReceivableNotices(db, NOW), []);
    await db.close();
  });

  it('FIFO mahsup, yaşlandırma, kredi limiti, avans ve tedarikçi borcu', async () => {
    const { db, a, b } = await scenario();
    await db.execute("INSERT INTO settings (key, value) VALUES ('ar_start_date', '2026-06-01')");
    const report = await getReceivables(db, NOW);
    assert.equal(report.setupRequired, false);
    const alfa = report.customers.find((c) => c.customerId === a.id)!;
    // Açık: Eylül 2.500 (3.000 − 500, 17 gün gecikmiş) + Ekim 4.000 (vadesi gelmemiş)
    assert.equal(alfa.balance, 6500);
    assert.equal(alfa.overdue, 2500);
    assert.equal(alfa.aging.d1_30, 2500);
    assert.equal(alfa.aging.current, 4000);
    assert.equal(alfa.oldestOverdueDays, 17);
    assert.equal(alfa.overLimit, true);
    assert.equal(alfa.nextDueDate, '2026-10-24');
    const beta = report.customers.find((c) => c.customerId === b.id)!;
    assert.equal(beta.balance, -500); // avans
    assert.equal(beta.overdue, 0);
    assert.equal(report.summary.totalReceivable, 6500);
    assert.equal(report.summary.overdueCustomers, 1);
    assert.equal(report.summary.dueNext7, 4000);
    assert.equal(report.summary.totalPayable, 1200);
    assert.equal(report.summary.payableNext7, 1200);
    assert.equal(report.suppliers[0]!.supplier, 'Tedarik Ltd.');

    // Borç ödendi olarak işaretlenince listeden çıkar
    await data.setExpensePaid(db, report.suppliers[0]!.invoices[0]!.expenseId, { paidDate: '2026-10-18' });
    assert.equal((await getReceivables(db, NOW)).summary.totalPayable, 0);

    // Cari hesap ekstresi: yürüyen bakiye
    const ledger = (await getCustomerLedger(db, a.id, NOW))!;
    assert.deepEqual(ledger.entries.map((e) => e.balance), [2000, -500, 2500, 6500]);
    assert.equal(ledger.overdue, 2500);
    await db.close();
  });

  it('bildirim, asistan ve API', async () => {
    const { db, a } = await scenario();
    const app = createTestApp(db).listen(0);
    const base = `http://127.0.0.1:${(app.address() as AddressInfo).port}/api`;
    try {
      assert.equal(((await (await fetch(`${base}/receivables`)).json()) as { setupRequired: boolean }).setupRequired, true);
      const put = await fetch(`${base}/receivables/settings`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ startDate: '2026-06-01', defaultTermDays: 30, companyTaxId: '1234567890' }) });
      assert.equal(put.status, 200);
      assert.equal(((await put.json()) as { companyTaxId: string }).companyTaxId, '1234567890');
      const bad = await fetch(`${base}/receivables/settings`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ startDate: 'dün', defaultTermDays: 30 }) });
      assert.equal(bad.status, 400);

      const notices = await getReceivableNotices(db, NOW);
      assert.ok(notices.some((n) => n.id.startsWith('ar-overdue-') && /Vadesi geçen alacak/.test(n.title)));

      const xlsx = await fetch(`${base}/receivables/customers/${a.id}/ledger.xlsx`);
      assert.equal(xlsx.status, 200);
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(Buffer.from(await xlsx.arrayBuffer()) as never);
      assert.ok(workbook.getWorksheet('Cari Hesap Ekstresi')!.rowCount >= 8);

      const answer = await askAssistant(db, 'Kimden alacağımız var, vadesi geçen alacaklar ne durumda?');
      assert.equal(answer.intent, 'receivables');
      assert.match(answer.answer, /vadesi geçen/);
      const profile = await askAssistant(db, 'Alfa bakiyesi ne kadar?');
      assert.equal(profile.intent, 'customer');
      assert.match(profile.answer, /Cari bakiye/);

      // Tahsilatı olan müşteri silinemez
      assert.equal((await fetch(`${base}/data/customers/${a.id}`, { method: 'DELETE' })).status, 409);
    } finally {
      app.close();
      await db.close();
    }
  });
});
