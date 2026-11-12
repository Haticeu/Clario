import { Router, type Request } from 'express';
import { isCountry } from '../currency/countries.js';
import type { RateProvider } from '../currency/rates.js';
import type { DbClient } from '../db/types.js';
import { createDataRouter } from '../http/dataRoutes.js';
import { HttpError } from '../http/errors.js';
import { createReportRouter } from '../http/reportRoutes.js';
import { createStatementRouter } from '../http/statementRoutes.js';
import { createReceivableRouter } from '../http/receivableRoutes.js';
import { createApiRouter } from '../http/routes.js';
import type { NewsService } from '../news/service.js';
import { getSetting, setSetting } from '../repositories/settingsRepository.js';

/** Bir kullanıcının açık (şifresi çözülmüş, bellekteki) çalışma alanı. */
export interface Workspace {
  readonly id: string;
  readonly db: DbClient;
  readonly router: Router;
  /** Her istekten sonra çağrılır (ör. değişiklik varsa şifreleyip diske yaz) */
  afterRequest?(): void;
}

/** İsteğin oturumuna ait çalışma alanını bulur; oturum yoksa null (→ 401). */
export type WorkspaceResolver = (req: Request) => Workspace | null;

/** Tüm çalışma alanlarının ortak kullandığı servisler (döviz kurları, gündem/haberler) */
export interface WorkspaceServices {
  rates: RateProvider;
  news: NewsService;
}

export const PROFILE_KEYS = {
  email: 'profile_email',
  name: 'profile_name',
  onboarding: 'onboarding_completed',
  google: 'google_linked',
  country: 'profile_country',
} as const;

function bodyOf(req: Request): Record<string, unknown> {
  return req.body && typeof req.body === 'object' ? (req.body as Record<string, unknown>) : {};
}

/** Profil (/me). Veriler çalışma alanında, yani şifreli dosyada durur. */
function createAccountRouter(db: DbClient): Router {
  const router = Router();

  router.get('/me', async (_req, res) => {
    const [email, name, onboarding, google, country] = await Promise.all([
      getSetting(db, PROFILE_KEYS.email),
      getSetting(db, PROFILE_KEYS.name),
      getSetting(db, PROFILE_KEYS.onboarding),
      getSetting(db, PROFILE_KEYS.google),
      getSetting(db, PROFILE_KEYS.country),
    ]);
    res.json({ email, name, country, onboardingCompleted: onboarding === 'true', googleLinked: google === 'true' });
  });

  router.patch('/me', async (req, res) => {
    const body = bodyOf(req);
    if ('onboardingCompleted' in body) await setSetting(db, PROFILE_KEYS.onboarding, body.onboardingCompleted === true ? 'true' : 'false');
    if ('name' in body) {
      const name = typeof body.name === 'string' ? body.name.trim().slice(0, 80) : '';
      if (name.length < 2) throw new HttpError(400, 'Ad en az 2 karakter olmalı.');
      await setSetting(db, PROFILE_KEYS.name, name);
    }
    // Ülke değişince verilerin para birimi değişmez (girilmiş tutarlar o para biriminde); yalnızca profil ve gündem kaynakları
    if ('country' in body) {
      if (!isCountry(body.country)) throw new HttpError(400, 'Geçerli bir ülke seçin.');
      await setSetting(db, PROFILE_KEYS.country, body.country);
    }
    res.status(204).end();
  });

  return router;
}

/** Bir çalışma alanının tüm endpoint'leri: profil, analizler, gündem, raporlar ve veri girişi. */
export function createWorkspaceRouter(db: DbClient, services: WorkspaceServices): Router {
  const router = Router();
  router.use(createAccountRouter(db));
  router.use(createApiRouter(db, services));
  router.use(createReportRouter(db));
  router.use(createStatementRouter(db));
  router.use(createReceivableRouter(db));
  router.use(createDataRouter(db));
  return router;
}
