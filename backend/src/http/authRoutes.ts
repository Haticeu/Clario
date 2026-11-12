import { Router, type Request, type RequestHandler } from 'express';
import { PASSWORD_MIN_LENGTH, type AuthService } from '../auth/service.js';
import { rateLimit } from './security.js';

function body(req: Request): Record<string, unknown> {
  return req.body && typeof req.body === 'object' ? (req.body as Record<string, unknown>) : {};
}

/**
 * /api/auth — hesap oluşturma, giriş/çıkış, parola kurtarma ve hesap ayarları.
 * Oturum, HttpOnly + SameSite=Strict çerezde taşınır; yanıtlarda anahtar veya token dönmez
 * (tek istisna: kurtarma anahtarı, yalnızca oluşturulduğu anda bir kez gösterilmek üzere).
 */
export function createAuthRouter(auth: AuthService, options: { rateLimitMinutes?: number } = {}): Router {
  const router = Router();
  // IP başına deneme sınırı (giriş, kayıt, kurtarma). 0: kapalı (varsayılan; LOGIN_LOCKOUT_MINUTES ile açılır)
  const minutes = options.rateLimitMinutes ?? 0;
  const attempts: RequestHandler =
    minutes > 0
      ? rateLimit({ limit: 20, windowMs: minutes * 60_000, message: `Çok fazla deneme yapıldı. ${minutes} dakika sonra tekrar deneyin.` })
      : (_req, _res, next) => next();

  router.get('/status', async (_req, res) => {
    res.json({ ...(await auth.status()), passwordMinLength: PASSWORD_MIN_LENGTH });
  });

  router.post('/register', attempts, async (req, res) => {
    const user = await auth.register(res, req, body(req));
    res.status(201).json(user);
  });

  router.post('/login', attempts, async (req, res) => {
    res.json(await auth.login(res, req, body(req)));
  });

  router.post('/recover', attempts, async (req, res) => {
    res.json(await auth.recover(res, req, body(req)));
  });

  router.post('/logout', async (req, res) => {
    await auth.logout(req, res);
    res.status(204).end();
  });

  router.post('/password', attempts, async (req, res) => {
    await auth.changePassword(req, body(req));
    res.status(204).end();
  });

  router.post('/recovery-key', attempts, async (req, res) => {
    res.json({ recoveryKey: await auth.newRecoveryKey(req, body(req)) });
  });

  // Google ile giriş (tarayıcı yönlendirmeleri: GET)
  router.get('/google/start', attempts, (req, res) => {
    res.redirect(auth.googleStart(req, res));
  });
  router.get('/google/callback', attempts, async (req, res) => {
    res.redirect(await auth.googleCallback(req, res));
  });
  router.get('/google/pending', (req, res) => {
    res.json({ pending: auth.googleStatus(req) });
  });
  router.post('/google/complete', attempts, async (req, res) => {
    res.json(await auth.googleComplete(req, res, body(req)));
  });
  router.post('/google/cancel', (req, res) => {
    auth.googleCancel(req, res);
    res.status(204).end();
  });
  router.post('/google/unlink', async (req, res) => {
    await auth.googleUnlink(req);
    res.status(204).end();
  });

  router.post('/reset-data', attempts, async (req, res) => {
    await auth.resetData(req, body(req));
    res.status(204).end();
  });

  router.delete('/account', attempts, async (req, res) => {
    await auth.deleteAccount(req, res, body(req));
    res.status(204).end();
  });

  return router;
}
