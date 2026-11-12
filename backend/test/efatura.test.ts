import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import JSZip from 'jszip';
import { openDatabase } from '../src/db/index.js';
import { parseEInvoice, readEInvoices } from '../src/import/efatura.js';
import { runImport } from '../src/import/importer.js';
import { parseUpload } from '../src/import/mapping.js';

const COMPANY = { vkn: '1234567890', name: 'Clario Teknoloji A.Ş.', city: 'İstanbul' };

function party(p: { vkn?: string; tckn?: string; name?: string; person?: [string, string]; city: string }) {
  const id = p.vkn ? `<cbc:ID schemeID="VKN">${p.vkn}</cbc:ID>` : `<cbc:ID schemeID="TCKN">${p.tckn}</cbc:ID>`;
  const name = p.person
    ? `<cac:Person><cbc:FirstName>${p.person[0]}</cbc:FirstName><cbc:FamilyName>${p.person[1]}</cbc:FamilyName></cac:Person>`
    : `<cac:PartyName><cbc:Name>${p.name}</cbc:Name></cac:PartyName>`;
  return `<cac:Party><cac:PartyIdentification>${id}</cac:PartyIdentification><cac:PartyIdentification><cbc:ID schemeID="MERSISNO">0123</cbc:ID></cac:PartyIdentification>${name}<cac:PostalAddress><cbc:CityName>${p.city}</cbc:CityName></cac:PostalAddress></cac:Party>`;
}

function invoice(o: {
  id: string;
  date: string;
  type?: string;
  supplier: Parameters<typeof party>[0];
  customer: Parameters<typeof party>[0];
  lines: [string, string, number, number][];
  due?: string;
  currency?: string;
  rate?: number;
}) {
  const net = o.lines.reduce((s, l) => s + l[2] * l[3], 0);
  const lines = o.lines
    .map(
      ([code, name, qty, price], i) => `<cac:InvoiceLine><cbc:ID>${i + 1}</cbc:ID><cbc:InvoicedQuantity unitCode="C62">${qty}</cbc:InvoicedQuantity>
      <cbc:LineExtensionAmount currencyID="${o.currency ?? 'TRY'}">${(qty * price).toFixed(2)}</cbc:LineExtensionAmount>
      <cac:TaxTotal><cbc:TaxAmount currencyID="TRY">${(qty * price * 0.2).toFixed(2)}</cbc:TaxAmount></cac:TaxTotal>
      <cac:Item><cbc:Name>${name}</cbc:Name><cac:SellersItemIdentification><cbc:ID>${code}</cbc:ID></cac:SellersItemIdentification></cac:Item>
      <cac:Price><cbc:PriceAmount currencyID="TRY">${price}</cbc:PriceAmount></cac:Price></cac:InvoiceLine>`,
    )
    .join('');
  return `<?xml version="1.0" encoding="UTF-8"?>
<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2" xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2" xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2" xmlns:ext="urn:oasis:names:specification:ubl:schema:xsd:CommonExtensionComponents-2">
  <ext:UBLExtensions><ext:UBLExtension><ext:ExtensionContent><ds:Signature xmlns:ds="http://www.w3.org/2000/09/xmldsig#"><cbc:ID>IMZA-1</cbc:ID></ds:Signature></ext:ExtensionContent></ext:UBLExtension></ext:UBLExtensions>
  <cbc:UBLVersionID>2.1</cbc:UBLVersionID><cbc:CustomizationID>TR1.2</cbc:CustomizationID><cbc:ProfileID>TICARIFATURA</cbc:ProfileID>
  <cbc:ID>${o.id}</cbc:ID><cbc:CopyIndicator>false</cbc:CopyIndicator><cbc:UUID>uuid-${o.id}</cbc:UUID>
  <cbc:IssueDate>${o.date}</cbc:IssueDate><cbc:InvoiceTypeCode>${o.type ?? 'SATIS'}</cbc:InvoiceTypeCode>
  <cbc:DocumentCurrencyCode>${o.currency ?? 'TRY'}</cbc:DocumentCurrencyCode>
  ${o.rate ? `<cac:PricingExchangeRate><cbc:SourceCurrencyCode>${o.currency}</cbc:SourceCurrencyCode><cbc:TargetCurrencyCode>TRY</cbc:TargetCurrencyCode><cbc:CalculationRate>${o.rate}</cbc:CalculationRate></cac:PricingExchangeRate>` : ''}
  <cac:AdditionalDocumentReference><cbc:ID>XSLT-1</cbc:ID><cbc:IssueDate>2020-01-01</cbc:IssueDate></cac:AdditionalDocumentReference>
  <cac:AccountingSupplierParty>${party(o.supplier)}</cac:AccountingSupplierParty>
  <cac:AccountingCustomerParty>${party(o.customer)}</cac:AccountingCustomerParty>
  ${o.due ? `<cac:PaymentMeans><cbc:PaymentMeansCode>42</cbc:PaymentMeansCode><cbc:PaymentDueDate>${o.due}</cbc:PaymentDueDate></cac:PaymentMeans>` : ''}
  <cac:TaxTotal><cbc:TaxAmount currencyID="TRY">${(net * 0.2).toFixed(2)}</cbc:TaxAmount></cac:TaxTotal>
  <cac:LegalMonetaryTotal><cbc:LineExtensionAmount>${net.toFixed(2)}</cbc:LineExtensionAmount><cbc:TaxExclusiveAmount>${net.toFixed(2)}</cbc:TaxExclusiveAmount>
    <cbc:TaxInclusiveAmount>${(net * 1.2).toFixed(2)}</cbc:TaxInclusiveAmount><cbc:PayableAmount>${(net * 1.2).toFixed(2)}</cbc:PayableAmount></cac:LegalMonetaryTotal>
  ${lines}
</Invoice>`;
}

const company = { vkn: COMPANY.vkn, name: COMPANY.name, city: COMPANY.city };
const sale1 = invoice({ id: 'CLR2026000000001', date: '2026-09-02', due: '2026-10-02', supplier: company, customer: { vkn: '9876543210', name: 'Kuzey Holding A.Ş.', city: 'Ankara' }, lines: [['YZ-01', 'Yazılım Lisansı', 2, 15000], ['KR-01', 'Kurulum Hizmeti', 1, 4000]] });
const sale2 = invoice({ id: 'CLR2026000000002', date: '2026-09-10', supplier: company, customer: { tckn: '11111111110', person: ['Ayşe', 'Yılmaz'], city: 'İzmir' }, lines: [['YZ-01', 'Yazılım Lisansı', 1, 15000]] });
const saleUsd = invoice({ id: 'CLR2026000000003', date: '2026-09-12', currency: 'USD', rate: 40, supplier: company, customer: { vkn: '5555555555', name: 'Global Ltd.', city: 'İstanbul' }, lines: [['DN-01', 'Danışmanlık', 10, 100]] });
const returnInv = invoice({ id: 'CLR2026000000004', date: '2026-09-15', type: 'IADE', supplier: company, customer: { vkn: '9876543210', name: 'Kuzey Holding A.Ş.', city: 'Ankara' }, lines: [['KR-01', 'Kurulum Hizmeti', 1, 4000]] });
const purchase = invoice({ id: 'TDR2026000000077', date: '2026-09-05', due: '2026-09-20', supplier: { vkn: '4444444444', name: 'Donanım Tedarik Ltd. Şti.', city: 'Bursa' }, customer: company, lines: [['SRV', 'Sunucu', 1, 50000]] });

async function zipOf(files: Record<string, string>) {
  const zip = new JSZip();
  for (const [name, content] of Object.entries(files)) zip.file(name, content);
  return Buffer.from(await zip.generateAsync({ type: 'uint8array' }));
}

describe('e-Fatura (UBL-TR) aktarımı', () => {
  it('fatura okunur: no, tarih, taraflar, VKN/TCKN, vade, kalemler, toplamlar (imza ve ek belgedeki ID karışmaz)', () => {
    const inv = parseEInvoice(sale1)!;
    assert.equal(inv.id, 'CLR2026000000001');
    assert.equal(inv.issueDate, '2026-09-02');
    assert.equal(inv.dueDate, '2026-10-02');
    assert.equal(inv.supplier.taxId, COMPANY.vkn);
    assert.equal(inv.customer.name, 'Kuzey Holding A.Ş.');
    assert.equal(inv.customer.city, 'Ankara');
    assert.equal(inv.lines.length, 2);
    assert.deepEqual(inv.lines[0], { code: 'YZ-01', name: 'Yazılım Lisansı', quantity: 2, unitPrice: 15000, lineTotal: 30000 });
    assert.equal(inv.taxExclusive, 34000);
    assert.equal(inv.payable, 40800);
    assert.equal(parseEInvoice(sale2)!.customer.name, 'Ayşe Yılmaz');
    assert.equal(parseEInvoice(sale2)!.customer.taxId, '11111111110');
    assert.equal(parseEInvoice('<root/>'), null);
  });

  it("ZIP: firmamız tespit edilir; giden → satış, gelen → gider; döviz kurla çevrilir; iade satışa alınmaz", async () => {
    const buffer = await zipOf({ 'a.xml': sale1, 'b.xml': sale2, 'c.xml': saleUsd, 'd.xml': returnInv, 'e.xml': purchase, 'notlar.txt': 'x' });
    const { companyTaxId, grids, invoices } = await readEInvoices(buffer);
    assert.equal(companyTaxId, COMPANY.vkn);
    assert.equal(invoices.length, 5);
    assert.deepEqual(grids.map((g) => g.name), ['e-Fatura Satışlar', 'e-Fatura Alışlar (Giderler)']);

    const db = await openDatabase(':memory:');
    const report = await runImport(db, await parseUpload(buffer), { mode: 'merge', commit: true });
    assert.equal(report.ok, true, JSON.stringify(report.errors));
    assert.equal(report.counts.orders.created, 3);
    assert.equal(report.counts.expenses.created, 1);
    assert.ok(report.warnings.some((w) => /iade/.test(w.message)));

    const order = await db.queryOne<{ due: string; total: number; tax: string; region: string }>(
      `SELECT o.due_date AS due, o.invoice_total AS total, c.tax_id AS tax, r.name AS region
       FROM orders o JOIN customers c ON c.id = o.customer_id JOIN regions r ON r.id = o.region_id WHERE o.order_no = 'CLR2026000000001'`,
    );
    assert.deepEqual({ ...order }, { due: '2026-10-02', total: 40800, tax: '9876543210', region: 'Ankara' });
    const usd = await db.queryOne<{ total: number; price: number }>(
      `SELECT o.invoice_total AS total, oi.unit_price AS price FROM orders o JOIN order_items oi ON oi.order_id = o.id WHERE o.order_no = 'CLR2026000000003'`,
    );
    assert.deepEqual({ ...usd }, { total: 48000, price: 4000 });
    const expense = await db.queryOne<{ supplier: string; amount: number; total: number; due: string; no: string; paid: string | null }>(
      'SELECT supplier, amount, invoice_total AS total, due_date AS due, invoice_no AS no, paid_date AS paid FROM expenses',
    );
    assert.deepEqual({ ...expense }, { supplier: 'Donanım Tedarik Ltd. Şti.', amount: 50000, total: 60000, due: '2026-09-20', no: 'TDR2026000000077', paid: null });

    // Aynı arşiv tekrar yüklenince kayıtlar çoğalmaz
    const again = await runImport(db, await parseUpload(buffer), { mode: 'merge', commit: true });
    assert.equal(again.counts.orders.created, 0);
    assert.equal(again.counts.orders.updated, 3);
    assert.equal(again.counts.expenses.created, 0);
    assert.equal((await db.queryOne<{ n: number }>('SELECT COUNT(*) AS n FROM orders'))!.n, 3);
    await db.close();
  });

  it('müşteri vergi numarasıyla eşleşir (ad farklı yazılmış olsa da)', async () => {
    const db = await openDatabase(':memory:');
    await runImport(db, await parseUpload(Buffer.from(sale1)), { mode: 'merge', commit: true, });
    const renamed = sale1.replace('Kuzey Holding A.Ş.', 'KUZEY HOLDİNG ANONİM ŞİRKETİ').replace('CLR2026000000001', 'CLR2026000000009').replace('uuid-CLR2026000000001', 'uuid-9');
    await runImport(db, await parseUpload(Buffer.from(renamed), undefined, { companyTaxId: COMPANY.vkn }), { mode: 'merge', commit: true });
    assert.equal((await db.queryOne<{ n: number }>('SELECT COUNT(*) AS n FROM customers'))!.n, 1);
    await db.close();
  });

  it('Excel (.xlsx) dosyası e-Fatura sanılmaz; bozuk XML anlaşılır hata verir', async () => {
    const { buildTemplate } = await import('../src/import/workbook.js');
    assert.equal((await parseUpload(await buildTemplate())).length, 8);
    await assert.rejects(() => parseUpload(Buffer.from('<?xml version="1.0"?><Invoice><bozuk')), /e-Fatura bulunamadı/);
  });
});
