import ExcelJS from 'exceljs';
import { parseIsoDate } from '../utils/dates.js';
import type { Statement } from './statement.js';

const HEADER_FILL: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F1B2D' } };
const toDate = (iso: string) => parseIsoDate(iso);

function table(
  workbook: ExcelJS.Workbook,
  title: string,
  columns: { header: string; key: string; width: number; money?: boolean; percent?: boolean; date?: boolean }[],
  rows: Record<string, unknown>[],
  moneyFormat: string,
) {
  const sheet = workbook.addWorksheet(title, { views: [{ state: 'frozen', ySplit: 1 }] });
  sheet.columns = columns.map((c) => ({ header: c.header, key: c.key, width: c.width }));
  const header = sheet.getRow(1);
  header.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  header.fill = HEADER_FILL;
  for (const row of rows) sheet.addRow(row);
  for (const c of columns) {
    const column = sheet.getColumn(c.key);
    if (c.money) column.numFmt = moneyFormat;
    if (c.percent) column.numFmt = '0.0%';
    if (c.date) column.numFmt = 'dd.mm.yyyy';
  }
  return sheet;
}

/** Ekstre / rapor Excel dosyası: Özet, Günlük, Kategoriler, Ürünler, Müşteriler, Giderler, İşlemler */
export async function buildStatementWorkbook(statement: Statement, currency: string): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Clario';
  const money = `#,##0.00 "${currency}"`;

  const summary = workbook.addWorksheet('Özet');
  summary.columns = [{ width: 34 }, { width: 22 }, { width: 22 }];
  summary.addRow([statement.title]).font = { bold: true, size: 14 };
  summary.addRow([`${statement.business.name ?? ''}${statement.business.email ? ` · ${statement.business.email}` : ''}`]);
  summary.addRow([`Dönem: ${statement.period.from} – ${statement.period.to} · Para birimi: ${currency}`]);
  summary.addRow([]);
  const head = summary.addRow(['Gösterge', 'Bu dönem', 'Önceki dönem']);
  head.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  head.fill = HEADER_FILL;
  const t = statement.totals;
  const p = statement.previousTotals;
  const lines: [string, number | null, number | null, boolean][] = [
    ['Ciro', t.revenue, p.revenue, true],
    ['Sipariş sayısı', t.orders, p.orders, false],
    ['Satılan adet', t.units, p.units, false],
    ['Müşteri sayısı', t.customers, p.customers, false],
    ['Ortalama sipariş tutarı', t.avgOrderValue, p.avgOrderValue, true],
    ['Brüt kâr (maliyeti bilinen ürünler)', t.grossProfit, p.grossProfit, true],
    ['Giderler', statement.expenses, null, true],
    ['Net katkı', statement.netContribution, null, true],
    ['İptal edilen sipariş', statement.cancelled.orders, null, false],
    ['İptal tutarı', statement.cancelled.amount, null, true],
    ['Yeni müşteri', statement.newCustomers, null, false],
  ];
  for (const [label, current, previous, isMoney] of lines) {
    const row = summary.addRow([label, current, previous]);
    if (isMoney) {
      row.getCell(2).numFmt = money;
      row.getCell(3).numFmt = money;
    }
  }
  summary.addRow([]);
  summary.addRow(['Öne çıkanlar']).font = { bold: true };
  for (const h of statement.highlights) summary.addRow([h]);

  if (statement.days.length > 0) {
    table(
      workbook,
      'Günlük',
      [
        { header: 'Tarih', key: 'date', width: 14, date: true },
        { header: 'Sipariş', key: 'orders', width: 10 },
        { header: 'Adet', key: 'units', width: 10 },
        { header: 'Ciro', key: 'revenue', width: 18, money: true },
      ],
      statement.days.map((d) => ({ ...d, date: toDate(d.date) })),
      money,
    );
  }
  const breakdownColumns = (name: string) => [
    { header: name, key: 'name', width: 34 },
    { header: 'Ciro', key: 'revenue', width: 18, money: true },
    { header: 'Pay', key: 'share', width: 10, percent: true },
    { header: 'Sipariş', key: 'orders', width: 10 },
    { header: 'Adet', key: 'units', width: 10 },
    { header: 'Önceki dönem', key: 'previousRevenue', width: 18, money: true },
    { header: 'Değişim', key: 'changePct', width: 10, percent: true },
  ];
  table(workbook, 'Kategoriler', breakdownColumns('Kategori'), statement.categories as unknown as Record<string, unknown>[], money);
  table(workbook, 'Ürünler', breakdownColumns('Ürün'), statement.products as unknown as Record<string, unknown>[], money);
  table(workbook, 'Müşteriler', breakdownColumns('Müşteri'), statement.customers as unknown as Record<string, unknown>[], money);
  if (statement.projects.length > 0) table(workbook, 'Projeler', breakdownColumns('Proje'), statement.projects as unknown as Record<string, unknown>[], money);
  table(
    workbook,
    'Giderler',
    [
      { header: 'Gider türü', key: 'category', width: 26 },
      { header: 'Kayıt', key: 'count', width: 10 },
      { header: 'Tutar', key: 'amount', width: 18, money: true },
    ],
    statement.expenseCategories,
    money,
  );
  table(
    workbook,
    'İşlemler',
    [
      { header: 'Tarih', key: 'date', width: 13, date: true },
      { header: 'Sipariş no', key: 'orderNo', width: 14 },
      { header: 'Müşteri', key: 'customer', width: 30 },
      { header: 'Bölge', key: 'region', width: 14 },
      { header: 'Kalem', key: 'items', width: 8 },
      { header: 'Tutar', key: 'amount', width: 16, money: true },
      { header: 'Durum', key: 'status', width: 14 },
      { header: 'Departman', key: 'department', width: 16 },
      { header: 'Proje', key: 'project', width: 22 },
    ],
    statement.orders.map((o) => ({ ...o, date: toDate(o.date), orderNo: o.orderNo ?? `#${o.id}`, status: o.status === 'cancelled' ? 'İptal' : 'Teslim edildi' })),
    money,
  );
  return Buffer.from(await workbook.xlsx.writeBuffer());
}
