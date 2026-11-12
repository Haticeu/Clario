import { buildAnalysisContext, type AnalysisContext } from '../src/analysis/context.js';
import { createApp } from '../src/app.js';
import { ecbRateProvider, type RateProvider } from '../src/currency/rates.js';
import { openDatabase, type DbClient } from '../src/db/index.js';
import type { CorsPolicy } from '../src/http/cors.js';
import { createNewsService, type NewsService } from '../src/news/service.js';
import { seedDatabase } from '../src/seed/generate.js';
import { createWorkspaceRouter } from '../src/workspace/router.js';

/** Testler sabit bir "bugün" ile çalışır; sonuçlar sistem tarihinden bağımsızdır. */
export const TEST_AS_OF = '2026-06-30';

export async function createSeededDb(): Promise<{ db: DbClient; ctx: AnalysisContext }> {
  const db = await openDatabase(':memory:');
  await seedDatabase(db, { asOf: TEST_AS_OF });
  return { db, ctx: buildAnalysisContext(TEST_AS_OF) };
}

/**
 * Analiz ve veri endpoint'lerini tek bir çalışma alanıyla test etmek için uygulama. Oturum katmanı
 * burada atlanır (her istek aynı çalışma alanına gider); hesap ve şifreleme ayrıca auth.test.ts'de test edilir.
 * Bu yalnızca testlerde vardır: üretimde oturumsuz erişim yolu yoktur.
 */
export function createTestApp(
  db: DbClient,
  options: { corsOrigins?: CorsPolicy; rateProvider?: RateProvider; news?: NewsService } = {},
) {
  const rates = options.rateProvider ?? ecbRateProvider;
  // Varsayılan: ağa çıkmayan, boş haber kaynağı
  const news = options.news ?? createNewsService({ fetchFeed: async () => [], rates });
  const router = createWorkspaceRouter(db, { rates, news });
  const workspace = { id: 'test', db, router };
  return createApp({ workspaces: () => workspace, corsOrigins: options.corsOrigins });
}

/**
 * Tarayıcıdaki arayüz gibi, veri değiştiren isteklere CSRF başlığını ekler. Başlığı açıkça veren
 * (ör. boş değerle CSRF'yi test eden) istekler olduğu gibi gider.
 */
const nativeFetch = globalThis.fetch;
globalThis.fetch = (input, init = {}) => {
  const headers = new Headers(init.headers);
  if (!headers.has('x-clario-client')) headers.set('x-clario-client', 'test');
  return nativeFetch(input, { ...init, headers });
};
