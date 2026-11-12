// Clario'nun backend'ini cihazda başlatır: hesaplar, şifreli çalışma alanları, analizler, raporlar ve gündem
// bilgisayardaki sürümle aynı koddur; yalnızca HTTP sunucusu yerine uygulama içi köprü (adapter) kullanılır.
import type { AxiosAdapter } from 'axios'
import { createApp } from '../../backend/src/app'
import { AuthService } from '../../backend/src/auth/service'
import { ecbRateProvider } from '../../backend/src/currency/rates'
import { createSqliteClient } from '../../backend/src/db/sqlite'
import { createAuthRouter } from '../../backend/src/http/authRoutes'
import { fetchArticle } from '../../backend/src/news/article'
import { fetchFeed } from '../../backend/src/news/rss'
import { createNewsService } from '../../backend/src/news/service'
import { createInProcessAdapter } from './adapter'
import type { ShimApp } from './shims/express'

/** Uygulamanın özel depolama alanındaki veri klasörü (bkz. shims/fs.ts) */
const DATA_DIR = 'data'

/**
 * Telefonda parola anahtarı türetme maliyeti: N=2^16 (64 MB bellek, telefonda ~1 sn). Bilgisayardaki 2^17 (128 MB)
 * WebView'da bellek açısından riskli olurdu. Parametre her hesapla birlikte saklanır.
 */
const MOBILE_KDF = { N: 2 ** 16, r: 8, p: 1 }

export async function startBackend(): Promise<{ adapter: AxiosAdapter; auth: AuthService }> {
  const system = createSqliteClient(`${DATA_DIR}/system.db`)
  const auth = await AuthService.create(system, {
    dataDir: DATA_DIR,
    cookieSecure: false,
    device: true,
    kdfParams: MOBILE_KDF,
    services: { rates: ecbRateProvider, news: createNewsService({ fetchFeed, fetchArticle, rates: ecbRateProvider }) },
  })
  const app = createApp({ workspaces: auth.resolve, authRouter: createAuthRouter(auth) }) as unknown as ShimApp
  return { adapter: createInProcessAdapter(app), auth }
}
