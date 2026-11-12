import { Router, type Request } from 'express';
import { getReport } from '../analysis/reports.js';
import type { DbClient } from '../db/types.js';
import { getReportOptions, NONE_VALUE, type Period, type ReportFilter } from '../repositories/reportRepository.js';
import { daysBetween, todayIso } from '../utils/dates.js';
import { HttpError } from './errors.js';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
/** Tek raporda en fazla ~30 yıl */
const MAX_DAYS = 11_000;

function text(req: Request, name: string): string | undefined {
  const value = req.query[name];
  if (value === undefined || value === '') return undefined;
  if (typeof value !== 'string' || value.length > 120) throw new HttpError(400, `Geçersiz filtre: ${name}`);
  return value.trim();
}

function id(req: Request, name: string): number | undefined {
  const value = text(req, name);
  if (value === undefined) return undefined;
  const number = Number(value);
  if (!Number.isInteger(number) || number <= 0) throw new HttpError(400, `Geçersiz filtre: ${name}`);
  return number;
}

function date(req: Request, name: string): string | undefined {
  const value = text(req, name);
  if (value === undefined) return undefined;
  if (!ISO_DATE.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`))) {
    throw new HttpError(400, `Geçersiz tarih (${name}): YYYY-AA-GG biçiminde olmalı.`);
  }
  return value;
}

/**
 * GET /reports/* sorgu parametreleri:
 *   from, to (YYYY-AA-GG, dahil; verilmezse verinin tamamı) · status=delivered|cancelled|all
 *   category · productId · customerId · customerType=Bayi|Mağaza · regionId · department · project
 *   (department/project için "__none__" = atanmamış) · offset (sipariş listesi sayfası)
 */
export function readReportQuery(req: Request): { filter: ReportFilter; from?: string; to?: string; offset: number } {
  const status = text(req, 'status') ?? 'delivered';
  if (status !== 'delivered' && status !== 'cancelled' && status !== 'all') throw new HttpError(400, 'Geçersiz filtre: status');
  const customerType = text(req, 'customerType');
  if (customerType && customerType !== 'Bayi' && customerType !== 'Mağaza') throw new HttpError(400, 'Geçersiz filtre: customerType');
  const offset = Number(text(req, 'offset') ?? 0);
  if (!Number.isInteger(offset) || offset < 0) throw new HttpError(400, 'Geçersiz filtre: offset');
  return {
    filter: {
      status,
      category: text(req, 'category'),
      productId: id(req, 'productId'),
      customerId: id(req, 'customerId'),
      customerType,
      regionId: id(req, 'regionId'),
      department: text(req, 'department'),
      project: text(req, 'project'),
    },
    from: date(req, 'from'),
    to: date(req, 'to'),
    offset,
  };
}

/** Filtrelenebilir raporlar: yıl, ay, tarih aralığı, kategori, ürün, müşteri, bölge, departman, proje. */
export function createReportRouter(db: DbClient): Router {
  const router = Router();

  router.get('/reports/options', async (_req, res) => {
    const options = await getReportOptions(db);
    res.json({ ...options, noneValue: NONE_VALUE, customerTypes: ['Bayi', 'Mağaza'] });
  });

  router.get('/reports/summary', async (req, res) => {
    const { filter, from, to, offset } = readReportQuery(req);
    const { dataRange } = await getReportOptions(db);
    // Tarih verilmezse verinin tamamı (veri yoksa bugün)
    const period: Period = {
      from: from ?? dataRange.from ?? todayIso(),
      to: to ?? dataRange.to ?? todayIso(),
    };
    if (period.from > period.to) throw new HttpError(400, 'Başlangıç tarihi bitiş tarihinden sonra olamaz.');
    if (daysBetween(period.from, period.to) > MAX_DAYS) throw new HttpError(400, 'Tarih aralığı çok uzun.');
    res.json({ ...(await getReport(db, filter, period, offset)), dataRange });
  });

  return router;
}
