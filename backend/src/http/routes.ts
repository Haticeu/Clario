import { Router, type Request } from 'express';
import { getAnalysisContext } from '../analysis/context.js';
import { getCustomerAnalysis } from '../analysis/customers.js';
import { getDashboardSummary } from '../analysis/dashboard.js';
import { getInventoryIntelligence } from '../analysis/inventory.js';
import { getRecommendations } from '../analysis/recommendations.js';
import { getSalesAnalytics } from '../analysis/sales.js';
import { getSegmentAnalysis } from '../analysis/segments.js';
import { getOrderDetail, MAX_QUERY, search } from '../analysis/search.js';
import { detectCustomerChurn, detectOpportunities, detectRisks, marginAnalysis } from '../analytics.js';
import { askAssistant, EXAMPLE_QUESTIONS } from '../assistant/index.js';
import * as thresholds from '../config/thresholds.js';
import { currentMoney } from '../currency/money.js';
import type { RateProvider } from '../currency/rates.js';
import type { DbClient } from '../db/types.js';
import { SEEN_KEY, type NewsService } from '../news/service.js';
import { getReportNotices } from '../analysis/statement.js';
import { getReceivableNotices } from '../analysis/receivables.js';
import { getSetting } from '../repositories/settingsRepository.js';
import { getRecordCounts } from '../repositories/catalogRepository.js';
import { getLatestOrderDate } from '../repositories/salesRepository.js';
import { HttpError } from './errors.js';
import { convertedMoney } from './money.js';

const MAX_QUESTION_LENGTH = 500;

function readQuestion(req: Request): string {
  const question: unknown = req.body?.question;
  if (typeof question !== 'string' || question.trim() === '') {
    throw new HttpError(400, "'question' alanı zorunludur ve metin olmalıdır.");
  }
  if (question.length > MAX_QUESTION_LENGTH) {
    throw new HttpError(400, `Soru en fazla ${MAX_QUESTION_LENGTH} karakter olabilir.`);
  }
  return question.trim();
}


export interface ApiServices {
  rates: RateProvider;
  news: NewsService;
}

/** Express 5, async handler'lardan fırlatılan hataları otomatik olarak hata middleware'ine iletir. */
export function createApiRouter(db: DbClient, services: ApiServices): Router {
  const router = Router();

  // Analiz endpoint'leri tutarları istenen para biriminde döner (X-Clario-Currency başlığı veya ?currency=)
  router.use(
    ['/dashboard', '/sales', '/inventory', '/customers', '/risks', '/opportunities', '/margins', '/recommendations', '/segments', '/reports', '/assistant/ask', '/currency', '/news', '/search', '/orders', '/statements'],
    convertedMoney(db, services.rates),
  );

  // Kök adres: tarayıcıdan açıldığında 404 yerine kullanılabilir endpoint'leri listeler.
  router.get('/', (_req, res) => {
    res.json({
      name: 'Clario API',
      endpoints: [
        'GET  /api/health',
        'GET  /api/dashboard/summary',
        'GET  /api/sales/analytics',
        'GET  /api/inventory/intelligence',
        'GET  /api/customers/analysis',
        'GET  /api/customers/churn',
        'GET  /api/risks',
        'GET  /api/opportunities',
        'GET  /api/margins',
        'GET  /api/recommendations',
        'GET  /api/reports/options · GET /api/reports/summary?from&to&category&customerId&regionId&department&project…  → filtrelenebilir rapor',
        'GET  /api/segments  → departman ve proje bazında ciro, gider ve net katkı',
        'GET  /api/assistant/examples',
        'POST /api/assistant/ask  { "question": "..." }',
        'GET  /api/config/thresholds',
        'GET  /api/currency  → gösterim para birimi ve kullanılan kur (X-Clario-Currency: TRY|USD|EUR|GBP)',
        'GET|PUT /api/settings  { "baseCurrency": "TRY" }',
        'GET  /api/search?q= · GET /api/orders/:id  → genel arama ve işlem ayrıntısı',
        'GET  /api/news · GET /api/news/:id/article · POST /api/news/seen  → gündem: haberlerin işletmeye olası etkileri (bildirimler)',
        'GET|POST|PUT|DELETE /api/data/{regions|products|employees|customers|expenses}[/:id]',
        'GET|POST /api/data/orders · PATCH|DELETE /api/data/orders/:id · GET /api/data/orders/:id/items',
        'GET|PUT /api/data/inventory',
        'GET  /api/import/template · GET /api/import/export',
        'POST /api/import/analyze  (gövde: .xlsx/.csv) → sütun eşleştirme önerisi',
        'POST /api/import?mode=merge|replace&dryRun=true  (gövde: .xlsx/.csv, başlık: X-Clario-Mapping)',
      ],
    });
  });

  router.get('/health', async (_req, res) => {
    const [counts, dataAsOf] = await Promise.all([getRecordCounts(db), getLatestOrderDate(db)]);
    res.json({ status: 'ok', database: db.dialect, dataAsOf, records: counts });
  });

  router.get('/config/thresholds', (_req, res) => {
    res.json(thresholds);
  });

  router.get('/dashboard/summary', async (_req, res) => {
    const ctx = await getAnalysisContext(db);
    res.json(await getDashboardSummary(db, ctx));
  });

  router.get('/sales/analytics', async (_req, res) => {
    const ctx = await getAnalysisContext(db);
    res.json(await getSalesAnalytics(db, ctx));
  });

  router.get('/inventory/intelligence', async (_req, res) => {
    const ctx = await getAnalysisContext(db);
    res.json(await getInventoryIntelligence(db, ctx));
  });

  router.get('/customers/analysis', async (_req, res) => {
    const ctx = await getAnalysisContext(db);
    res.json(await getCustomerAnalysis(db, ctx));
  });

  router.get('/customers/churn', async (_req, res) => {
    const ctx = await getAnalysisContext(db);
    const items = await detectCustomerChurn(db, ctx);
    res.json({ asOf: ctx.asOf, count: items.length, items });
  });

  router.get('/risks', async (_req, res) => {
    const ctx = await getAnalysisContext(db);
    const items = await detectRisks(db, ctx);
    res.json({ asOf: ctx.asOf, count: items.length, items });
  });

  router.get('/opportunities', async (_req, res) => {
    const ctx = await getAnalysisContext(db);
    const items = await detectOpportunities(db, ctx);
    res.json({ asOf: ctx.asOf, count: items.length, items });
  });

  router.get('/margins', async (_req, res) => {
    const ctx = await getAnalysisContext(db);
    const items = await marginAnalysis(db, ctx);
    res.json({ asOf: ctx.asOf, count: items.length, items });
  });

  router.get('/segments', async (_req, res) => {
    const ctx = await getAnalysisContext(db);
    res.json(await getSegmentAnalysis(db, ctx));
  });

  router.get('/recommendations', async (_req, res) => {
    const ctx = await getAnalysisContext(db);
    res.json(await getRecommendations(db, ctx));
  });

  router.get('/assistant/examples', (_req, res) => {
    res.json({ examples: EXAMPLE_QUESTIONS });
  });

  router.post('/assistant/ask', async (req, res) => {
    res.json(await askAssistant(db, readQuestion(req), { news: services.news }));
  });

  router.get('/currency', (_req, res) => {
    const { base, display, latestFactor, rateDate, source } = currentMoney();
    res.json({ base, display, rate: latestFactor, rateDate, source });
  });

  /** Genel arama (üst çubuk): müşteri, işlem, ürün, kategori, bölge, departman/proje, gider */
  router.get('/search', async (req, res) => {
    const q = typeof req.query.q === 'string' ? req.query.q : '';
    if (q.length > MAX_QUERY) throw new HttpError(400, `Arama en fazla ${MAX_QUERY} karakter olabilir.`);
    res.json(await search(db, q));
  });

  /** Tek işlemin ayrıntısı (arama sonucundan açılır) */
  router.get('/orders/:id', async (req, res) => {
    const id = Number(req.params.id);
    const order = Number.isInteger(id) && id > 0 ? await getOrderDetail(db, id) : null;
    if (!order) throw new HttpError(404, 'İşlem bulunamadı.');
    res.json(order);
  });

  /** Gündem: ekonomi haberleri temalara ayrılır ve işletmenin verisiyle ilişkilendirilir (bildirim paneli) */
  // Zil: gündem + rapor bildirimleri (aylık ekstre, gün sonu raporu); okunmamış sayısı ikisini birlikte sayar
  router.get('/news', async (_req, res) => {
    const [feed, reportNotices, receivableNotices, seenAt] = await Promise.all([
      services.news.getFeed(db),
      getReportNotices(db),
      getReceivableNotices(db),
      getSetting(db, SEEN_KEY),
    ]);
    const notices = [...receivableNotices, ...reportNotices];
    const seen = seenAt ? Date.parse(seenAt) : 0;
    res.json({ ...feed, notices, unread: feed.unread + notices.filter((n) => Date.parse(n.availableAt) > seen).length });
  });

  /** Haber metni: Clario içinde okunur (yalnızca gündemdeki haberler; istemci adres gönderemez) */
  router.get('/news/:id/article', async (req, res) => {
    const id = String(req.params.id ?? '');
    const article = /^[0-9a-f]{16}$/.test(id) ? await services.news.getArticle(id) : null;
    if (!article) {
      res.status(404).json({ error: 'Haber bulunamadı. Gündemi yenileyip tekrar deneyin.' });
      return;
    }
    res.json(article);
  });

  router.post('/news/seen', async (_req, res) => {
    await services.news.markSeen(db);
    res.status(204).end();
  });

  return router;
}
