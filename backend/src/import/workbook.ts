import ExcelJS from 'exceljs';
import type { DbClient } from '../db/types.js';
import { parseIsoDate } from '../utils/dates.js';
import { INSTRUCTIONS_TITLE, SHEETS, templateColumns, type SheetSpec } from './sheets.js';

const HEADER_FILL = 'FF1E2B3C';
const REQUIRED_FILL = 'FF0C7F6C';
const MAX_VALIDATION_ROW = 5000;

/** exceljs, aralık bazlı doğrulamayı destekler ancak tip tanımlarında yer almaz. */
type SheetWithValidations = ExcelJS.Worksheet & {
  dataValidations: { add(range: string, validation: ExcelJS.DataValidation): void };
};

// ── Şablon ve dışa aktarma ───────────────────────────────────────────────────

function columnLetter(index: number): string {
  let letter = '';
  for (let n = index; n > 0; n = Math.floor((n - 1) / 26)) letter = String.fromCharCode(65 + ((n - 1) % 26)) + letter;
  return letter;
}

function addDataSheet(workbook: ExcelJS.Workbook, spec: SheetSpec, currencySymbol: string): ExcelJS.Worksheet {
  const columns = templateColumns(spec);
  const sheet = workbook.addWorksheet(spec.title, { views: [{ state: 'frozen', ySplit: 1 }] });
  // Tutar başlıkları verilerin para birimini gösterir: "Tutar (₺)", "Tutar ($)"…
  const title = (header: string) => header.replace('(₺)', `(${currencySymbol})`);
  sheet.columns = columns.map((c) => ({ header: c.required ? `${title(c.header)} *` : title(c.header), key: c.key, width: c.width }));

  const header = sheet.getRow(1);
  header.height = 22;
  columns.forEach((column, i) => {
    const cell = header.getCell(i + 1);
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: column.required ? REQUIRED_FILL : HEADER_FILL } };
    cell.alignment = { vertical: 'middle' };
    cell.note = `${column.required ? 'Zorunlu. ' : 'Opsiyonel. '}${column.note}`;

    const excelColumn = sheet.getColumn(i + 1);
    if (column.type === 'date') excelColumn.numFmt = 'dd.mm.yyyy';
    if (column.type === 'number') excelColumn.numFmt = '#,##0.00';
    if (column.type === 'integer') excelColumn.numFmt = '#,##0';
    if (column.choices) {
      const letter = columnLetter(i + 1);
      (sheet as SheetWithValidations).dataValidations.add(`${letter}2:${letter}${MAX_VALIDATION_ROW}`, {
        type: 'list',
        allowBlank: !column.required,
        formulae: [`"${column.choices.join(',')}"`],
        showErrorMessage: true,
        errorTitle: column.header,
        error: `Şunlardan birini seçin: ${column.choices.join(', ')}`,
      });
    }
  });
  return sheet;
}

function addInstructions(workbook: ExcelJS.Workbook): void {
  const sheet = workbook.addWorksheet(INSTRUCTIONS_TITLE);
  sheet.columns = [{ width: 26 }, { width: 110 }];
  const title = sheet.addRow(['Clario — Veri Şablonu']);
  title.font = { bold: true, size: 16 };
  sheet.addRow([]);
  const lines = [
    'Nasıl kullanılır?',
    '1. Her sayfayı doldurun. Kullanmadığınız sayfaları boş bırakabilir veya silebilirsiniz.',
    '2. Yeşil başlıklı (*) sütunlar zorunludur, lacivert başlıklılar opsiyoneldir. Başlığın üzerine gelince açıklama görünür.',
    '3. Sütunların sırası önemli değildir. Kendi tablonuzu da yükleyebilirsiniz: Clario "Miktar", "Tutar", "Cari Adı" gibi farklı başlıkları anlamlarına göre tanır ve yüklemeden önce eşleştirmeyi gösterir.',
    '4. Tarihleri gün.ay.yıl (25.09.2026) veya Excel tarih biçiminde girin. Tutarları sayı olarak girin.',
    '5. Dosyayı Clario\'da "Veri Yönetimi → Excel ile Yükle" bölümünden yükleyin. Kaydetmeden önce kontrol edilir ve hatalı satırlar gösterilir.',
    '',
    'Aynı dosyayı tekrar yüklerseniz',
    '"Ekle / güncelle" modunda ürünler (ürün koduna göre), müşteriler (ada göre) ve siparişler (sipariş numarasına göre) güncellenir; kayıtlar çoğalmaz.',
    '"Tümünü değiştir" modunda mevcut tüm veriler silinir ve yerine bu dosyadaki veriler yazılır.',
    '',
    'Sayfalar',
    ...SHEETS.map((s) => `${s.title}: ${s.description}`),
  ];
  for (const line of lines) {
    const row = sheet.addRow(['', line]);
    if (['Nasıl kullanılır?', 'Aynı dosyayı tekrar yüklerseniz', 'Sayfalar'].includes(line)) row.font = { bold: true };
    row.getCell(2).alignment = { wrapText: true, vertical: 'top' };
  }
}

/** Boş şablon: talimat sayfası + her veri türü için bir sayfa. */
export async function buildTemplate(currencySymbol = '₺'): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Clario';
  addInstructions(workbook);
  for (const spec of SHEETS) addDataSheet(workbook, spec, currencySymbol);
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

const toDate = (iso: string | null) => (iso ? parseIsoDate(iso) : null);

/** Veritabanındaki tüm veriyi şablonla aynı biçimde dışa aktarır (düzenleyip geri yüklemek için). */
export async function buildExport(db: DbClient, currencySymbol = '₺'): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Clario';
  addInstructions(workbook);

  const rows: Record<SheetSpec['key'], Record<string, unknown>[]> = {
    regions: await db.query('SELECT name FROM regions ORDER BY name'),
    products: await db.query(
      'SELECT sku, name, category, unit_cost AS "unitCost", list_price AS "listPrice" FROM products ORDER BY sku',
    ),
    employees: (
      await db.query<{ hireDate: string } & Record<string, unknown>>(`
        SELECT e.full_name AS "fullName", e.role, r.name AS region, e.monthly_salary AS "monthlySalary", e.hire_date AS "hireDate"
        FROM employees e LEFT JOIN regions r ON r.id = e.region_id ORDER BY e.full_name`)
    ).map((r) => ({ ...r, hireDate: toDate(r.hireDate) })),
    customers: await db.query(`
      SELECT c.name, c.customer_type AS "customerType", r.name AS region, e.full_name AS "salesRep",
             c.tax_id AS "taxId", c.payment_term_days AS "paymentTermDays", c.credit_limit AS "creditLimit"
      FROM customers c JOIN regions r ON r.id = c.region_id LEFT JOIN employees e ON e.id = c.sales_rep_id
      ORDER BY c.name`),
    sales: (
      await db.query<{ orderDate: string; status: string; dueDate: string | null } & Record<string, unknown>>(`
        SELECT o.order_no AS "orderNo", o.order_date AS "orderDate", c.name AS customer, p.sku,
               oi.quantity, oi.unit_price AS "unitPrice", o.status, o.department, o.project, o.due_date AS "dueDate"
        FROM orders o
        JOIN customers c ON c.id = o.customer_id
        JOIN order_items oi ON oi.order_id = o.id
        JOIN products p ON p.id = oi.product_id
        ORDER BY o.order_date, o.id, oi.id`)
    ).map((r) => ({ ...r, orderDate: toDate(r.orderDate), dueDate: toDate(r.dueDate), status: r.status === 'cancelled' ? 'İptal' : 'Teslim edildi' })),
    inventory: await db.query(`
      SELECT p.sku, r.name AS region, i.quantity
      FROM inventory i JOIN products p ON p.id = i.product_id JOIN regions r ON r.id = i.region_id
      ORDER BY p.sku, r.name`),
    expenses: (
      await db.query<{ expenseDate: string; dueDate: string | null; paidDate: string | null } & Record<string, unknown>>(`
        SELECT x.expense_date AS "expenseDate", x.category, x.amount, r.name AS region, x.description, x.department, x.project,
               x.supplier, x.due_date AS "dueDate", x.paid_date AS "paidDate", x.invoice_no AS "invoiceNo", x.invoice_total AS "invoiceTotal"
        FROM expenses x LEFT JOIN regions r ON r.id = x.region_id ORDER BY x.expense_date, x.id`)
    ).map((r) => ({ ...r, expenseDate: toDate(r.expenseDate), dueDate: toDate(r.dueDate), paidDate: toDate(r.paidDate) })),
    payments: (
      await db.query<{ paymentDate: string } & Record<string, unknown>>(`
        SELECT p.payment_date AS "paymentDate", c.name AS customer, p.amount, p.method, p.reference, p.description
        FROM payments p JOIN customers c ON c.id = p.customer_id ORDER BY p.payment_date, p.id`)
    ).map((r) => ({ ...r, paymentDate: toDate(r.paymentDate) })),
  };

  for (const spec of SHEETS) {
    const sheet = addDataSheet(workbook, spec, currencySymbol);
    for (const row of rows[spec.key]) sheet.addRow(row);
  }
  return Buffer.from(await workbook.xlsx.writeBuffer());
}
