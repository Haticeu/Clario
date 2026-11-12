import express, { Router, type Request } from 'express';
import { CURRENCIES, CURRENCY_CODES, isCurrency } from '../currency/currencies.js';
import * as data from '../data/entities.js';
import type { DbClient } from '../db/types.js';
import { runImport, type ImportMode } from '../import/importer.js';
import { analyzeGrids, parseUpload, readGrids, type ImportMapping } from '../import/mapping.js';
import { looksLikeEInvoice, readEInvoices, type EInvoiceContext } from '../import/efatura.js';
import { getSetting, setSetting } from '../repositories/settingsRepository.js';
import { SHEETS, type SheetKey } from '../import/sheets.js';
import { buildExport, buildTemplate } from '../import/workbook.js';
import { todayIso } from '../utils/dates.js';
import { getBaseCurrency, setBaseCurrency } from '../repositories/settingsRepository.js';
import { HttpError } from './errors.js';
import { baseMoney } from './money.js';

const MAX_UPLOAD = '25mb';
/** Firmamızın vergi numarası (e-Fatura giden/gelen ayrımı) */
export const COMPANY_TAX_ID = 'company_tax_id';
const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

function idParam(req: Request): number {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) throw new HttpError(400, 'Geçersiz kayıt numarası.');
  return id;
}

const SHEET_KEYS = new Set<string>(SHEETS.map((s) => s.key));

/** X-Clario-Mapping başlığındaki eşleştirmeyi okur ve doğrular. */
function readMapping(req: Request): ImportMapping | undefined {
  const header = req.header('x-clario-mapping');
  if (!header) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(decodeURIComponent(header));
  } catch {
    throw new HttpError(400, 'Sütun eşleştirmesi okunamadı.');
  }
  const sheets = (parsed as { sheets?: unknown })?.sheets;
  if (!Array.isArray(sheets)) throw new HttpError(400, 'Sütun eşleştirmesi geçersiz.');
  return {
    sheets: sheets.map((s) => {
      const sheet = (s ?? {}) as Record<string, unknown>;
      const type = typeof sheet.type === 'string' && SHEET_KEYS.has(sheet.type) ? (sheet.type as SheetKey) : null;
      const columns = sheet.columns && typeof sheet.columns === 'object' ? (sheet.columns as Record<string, unknown>) : {};
      return {
        name: String(sheet.name ?? ''),
        type,
        headerRow: Number(sheet.headerRow) || 1,
        columns: Object.fromEntries(Object.entries(columns).filter(([, v]) => typeof v === 'string')) as Record<string, string>,
      };
    }),
  };
}

function body(req: Request): Record<string, unknown> {
  return req.body && typeof req.body === 'object' ? (req.body as Record<string, unknown>) : {};
}

/**
 * Veri yönetimi: uygulama içinden kayıt ekleme/düzenleme/silme (/api/data/…)
 * ve Excel ile toplu içe/dışa aktarma (/api/import/…).
 */
export function createDataRouter(db: DbClient): Router {
  const router = Router();
  // Kayıtlar her zaman girildikleri (ana) para biriminde okunur ve yazılır; çevrim yalnızca analizlerde
  router.use(['/data', '/import', '/settings'], baseMoney(db));

  // Ayarlar: verilerin girildiği para birimi. Değiştirmek mevcut tutarları çevirmez; yalnızca
  // tutarların hangi para biriminde olduğunu belirtir.
  router.get('/settings', async (_req, res) => {
    res.json({
      baseCurrency: await getBaseCurrency(db),
      currencies: CURRENCY_CODES.map((code) => ({ code, ...CURRENCIES[code] })),
    });
  });
  router.put('/settings', async (req, res) => {
    const { baseCurrency } = body(req);
    if (!isCurrency(baseCurrency)) throw new HttpError(400, `Para birimi şunlardan biri olmalı: ${CURRENCY_CODES.join(', ')}.`);
    await setBaseCurrency(db, baseCurrency);
    res.json({ baseCurrency });
  });

  // Basit varlıklar: liste, ekle, güncelle, sil
  const resources = [
    ['regions', data.listRegions, data.createRegion, data.updateRegion, data.deleteRegion],
    ['products', data.listProducts, data.createProduct, data.updateProduct, data.deleteProduct],
    ['employees', data.listEmployees, data.createEmployee, data.updateEmployee, data.deleteEmployee],
    ['customers', data.listCustomers, data.createCustomer, data.updateCustomer, data.deleteCustomer],
    ['expenses', data.listExpenses, data.createExpense, data.updateExpense, data.deleteExpense],
    ['payments', data.listPayments, data.createPayment, data.updatePayment, data.deletePayment],
  ] as const;

  for (const [name, list, create, update, remove] of resources) {
    router.get(`/data/${name}`, async (_req, res) => {
      res.json({ items: await list(db) });
    });
    router.post(`/data/${name}`, async (req, res) => {
      res.status(201).json(await create(db, body(req)));
    });
    router.put(`/data/${name}/:id`, async (req, res) => {
      await update(db, idParam(req), body(req));
      res.status(204).end();
    });
    router.delete(`/data/${name}/:id`, async (req, res) => {
      await remove(db, idParam(req));
      res.status(204).end();
    });
  }

  // Borç (gider faturası) ödendi / ödenmedi
  router.patch('/data/expenses/:id/paid', async (req, res) => {
    await data.setExpensePaid(db, idParam(req), body(req));
    res.status(204).end();
  });

  // Siparişler
  router.get('/data/orders', async (req, res) => {
    res.json(await data.listOrders(db, { limit: Number(req.query.limit), offset: Number(req.query.offset) }));
  });
  router.get('/data/orders/:id/items', async (req, res) => {
    res.json({ items: await data.getOrderItems(db, idParam(req)) });
  });
  router.post('/data/orders', async (req, res) => {
    res.status(201).json(await data.createOrder(db, body(req)));
  });
  router.patch('/data/orders/:id', async (req, res) => {
    await data.updateOrder(db, idParam(req), body(req));
    res.status(204).end();
  });
  router.delete('/data/orders/:id', async (req, res) => {
    await data.deleteOrder(db, idParam(req));
    res.status(204).end();
  });

  // Stok
  router.get('/data/inventory', async (_req, res) => {
    res.json({ items: await data.listInventory(db) });
  });
  router.put('/data/inventory', async (req, res) => {
    res.json(await data.setInventory(db, req.body));
  });

  // Excel
  // Excel başlıklarında tutarların para birimi gösterilir, ör. "Tutar (₺)"
  const currencySymbol = async () => CURRENCIES[await getBaseCurrency(db)].symbol;

  router.get('/import/template', async (_req, res) => {
    res.setHeader('Content-Type', XLSX_TYPE);
    res.setHeader('Content-Disposition', 'attachment; filename="clario-veri-sablonu.xlsx"');
    res.send(await buildTemplate(await currencySymbol()));
  });

  router.get('/import/export', async (_req, res) => {
    res.setHeader('Content-Type', XLSX_TYPE);
    res.setHeader('Content-Disposition', `attachment; filename="clario-veriler-${todayIso()}.xlsx"`);
    res.send(await buildExport(db, await currencySymbol()));
  });

  const upload = express.raw({ type: () => true, limit: MAX_UPLOAD });
  const fileOf = (req: Request): Buffer => {
    if (!Buffer.isBuffer(req.body) || req.body.length === 0) throw new HttpError(400, 'Yüklenecek dosya bulunamadı.');
    return req.body;
  };

  /**
   * POST /api/import/analyze — Gövde: .xlsx veya .csv dosyası.
   * Dosyadaki her sayfa için tahmin edilen veri türünü ve sütun eşleştirme önerisini döner;
   * hiçbir şey kaydedilmez. Arayüz bu öneriyi kullanıcıya gösterip düzeltmesine izin verir.
   */
  /** e-Fatura okurken firmamızın vergi numarası (giden/gelen ayrımı) ve verilerin para birimi */
  const einvoiceContext = async (): Promise<EInvoiceContext> => ({
    companyTaxId: await getSetting(db, COMPANY_TAX_ID),
    baseCurrency: await getBaseCurrency(db),
  });

  router.post('/import/analyze', upload, async (req, res) => {
    res.json({
      sheets: analyzeGrids(await readGrids(fileOf(req), await einvoiceContext())),
      types: SHEETS.map((spec) => ({
        key: spec.key,
        title: spec.title,
        fields: spec.columns.map((c) => ({ key: c.key, label: c.header.replace(/\s*\(.*\)\s*$/, ''), required: c.required })),
        requireAny: spec.requireAny ?? [],
      })),
    });
  });

  /**
   * POST /api/import?mode=merge|replace&dryRun=true&skipInvalid=true — Gövde: .xlsx veya .csv dosyası.
   * skipInvalid=true → hatalı satırlar atlanır, geçerli satırlar içe aktarılır.
   * X-Clario-Mapping başlığı (URI kodlu JSON) verilirse o sütun eşleştirmesi kullanılır,
   * verilmezse otomatik tahmin edilir. dryRun=true → yalnızca kontrol raporu; aksi halde
   * hata yoksa kaydeder, hata varsa 422 ile raporu döner ve hiçbir şey kaydetmez.
   */
  router.post('/import', upload, async (req, res) => {
    const mode: ImportMode = req.query.mode === 'replace' ? 'replace' : 'merge';
    const commit = req.query.dryRun !== 'true';
    const skipInvalidRows = req.query.skipInvalid === 'true';
    const file = fileOf(req);
    const context = await einvoiceContext();
    const report = await runImport(db, await parseUpload(file, readMapping(req), context), { mode, commit, skipInvalidRows });
    // e-Fatura aktarımında tespit edilen firma vergi numarası sonraki yüklemeler için saklanır
    if (report.committed && !context.companyTaxId && (await looksLikeEInvoice(file))) {
      const { companyTaxId } = await readEInvoices(file, context);
      if (companyTaxId) await setSetting(db, COMPANY_TAX_ID, companyTaxId);
    }
    res.status(commit && !report.ok ? 422 : 200).json(report);
  });

  return router;
}
