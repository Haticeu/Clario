import ExcelJS from 'exceljs';
import { Router, type Request } from 'express';
import { getCustomerLedger, getReceivables, getReceivableSettings, saveReceivableSettings } from '../analysis/receivables.js';
import type { DbClient } from '../db/types.js';
import { parseIsoDate } from '../utils/dates.js';
import { HttpError } from './errors.js';
import { baseMoney } from './money.js';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

function idParam(req: Request): number {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) throw new HttpError(400, 'Geçersiz kayıt numarası.');
  return id;
}

/** Cari hesap ve alacak/borç takibi (/api/receivables…). Tutarlar verilerin para biriminde. */
export function createReceivableRouter(db: DbClient): Router {
  const router = Router();
  router.use('/receivables', baseMoney(db));

  router.get('/receivables', async (_req, res) => {
    res.json(await getReceivables(db));
  });

  router.get('/receivables/settings', async (_req, res) => {
    res.json(await getReceivableSettings(db));
  });

  router.put('/receivables/settings', async (req, res) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const startDate = typeof body.startDate === 'string' ? body.startDate : null;
    if (startDate !== null && (!ISO_DATE.test(startDate) || Number.isNaN(Date.parse(`${startDate}T00:00:00Z`)))) {
      throw new HttpError(400, 'Takip başlangıç tarihi YYYY-AA-GG biçiminde olmalı.');
    }
    const term = Number(body.defaultTermDays);
    if (!Number.isInteger(term) || term < 0 || term > 365) throw new HttpError(400, 'Varsayılan vade 0–365 gün arasında olmalı.');
    let companyTaxId: string | null = null;
    if (typeof body.companyTaxId === 'string' && body.companyTaxId.trim()) {
      companyTaxId = body.companyTaxId.replace(/\D/g, '');
      if (companyTaxId.length !== 10 && companyTaxId.length !== 11) throw new HttpError(400, 'Firma vergi no 10 haneli VKN veya 11 haneli TCKN olmalı.');
    }
    const current = await getReceivableSettings(db);
    await saveReceivableSettings(db, { startDate: startDate ?? current.startDate, defaultTermDays: term, companyTaxId });
    res.json(await getReceivableSettings(db));
  });

  router.get('/receivables/customers/:id', async (req, res) => {
    const ledger = await getCustomerLedger(db, idParam(req));
    if (!ledger) throw new HttpError(404, 'Müşteri bulunamadı.');
    res.json(ledger);
  });

  /** Cari hesap ekstresi (Excel): hareketler, yürüyen bakiye ve açık faturalar */
  router.get('/receivables/customers/:id/ledger.xlsx', async (req, res) => {
    const ledger = await getCustomerLedger(db, idParam(req));
    if (!ledger) throw new HttpError(404, 'Müşteri bulunamadı.');
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Clario';
    const money = `#,##0.00 "${ledger.currency}"`;
    const sheet = workbook.addWorksheet('Cari Hesap Ekstresi', { views: [{ state: 'frozen', ySplit: 5 }] });
    sheet.columns = [{ width: 13 }, { width: 18 }, { width: 34 }, { width: 13 }, { width: 16 }, { width: 16 }, { width: 18 }];
    sheet.addRow([`${ledger.customer.name} — Cari Hesap Ekstresi`]).font = { bold: true, size: 14 };
    sheet.addRow([`Vergi no: ${ledger.customer.taxId ?? '—'} · ${ledger.customer.regionName} · Dönem: ${ledger.startDate} – ${ledger.asOf}`]);
    sheet.addRow([`Bakiye: ${ledger.balance.toLocaleString('tr-TR')} ${ledger.currency} · Vadesi geçen: ${ledger.overdue.toLocaleString('tr-TR')} ${ledger.currency}`]);
    sheet.addRow([]);
    const head = sheet.addRow(['Tarih', 'Belge No', 'Açıklama', 'Vade', 'Borç', 'Alacak', 'Bakiye']);
    head.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    head.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F1B2D' } };
    for (const e of ledger.entries) {
      const row = sheet.addRow([parseIsoDate(e.date), e.reference, e.description, e.dueDate ? parseIsoDate(e.dueDate) : null, e.debit || null, e.credit || null, e.balance]);
      row.getCell(1).numFmt = 'dd.mm.yyyy';
      row.getCell(4).numFmt = 'dd.mm.yyyy';
      for (const c of [5, 6, 7]) row.getCell(c).numFmt = money;
    }
    const safe = ledger.customer.name.replace(/[^\p{L}\p{N}]+/gu, '-').slice(0, 40);
    res.setHeader('Content-Type', XLSX_TYPE);
    res.setHeader('Content-Disposition', `attachment; filename="Clario-cari-ekstre-${encodeURIComponent(safe)}-${ledger.asOf}.xlsx"`);
    res.send(Buffer.from(await workbook.xlsx.writeBuffer()));
  });

  return router;
}
