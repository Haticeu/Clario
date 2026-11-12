import express, { type Router } from 'express';
import { cors, type CorsPolicy } from './http/cors.js';
import { errorHandler, notFoundHandler } from './http/errors.js';
import { requireClientHeader, securityHeaders } from './http/security.js';
import type { WorkspaceResolver } from './workspace/router.js';

export interface AppOptions {
  /** İsteğin oturumuna ait çalışma alanını bulur (oturum yoksa null → 401) */
  workspaces: WorkspaceResolver;
  /** /api/auth altındaki hesap endpoint'leri */
  authRouter?: Router;
  /** Tarayıcıdan erişime izin verilen adresler (frontend). Varsayılan: hiçbiri. */
  corsOrigins?: CorsPolicy;
  /** Ters vekil (proxy) arkasında çalışırken HTTPS ve istemci IP'sinin doğru okunması için */
  trustProxy?: boolean;
}

/**
 * Express uygulamasını oluşturur. Her kullanıcının verisi kendi çalışma alanındadır; analiz ve veri
 * endpoint'leri yalnızca oturum açmış kullanıcının çalışma alanında çalışır.
 */
export function createApp(options: AppOptions) {
  const app = express();
  app.disable('x-powered-by');
  if (options.trustProxy) app.set('trust proxy', 1);
  app.use(securityHeaders);
  app.use(cors(options.corsOrigins ?? []));
  app.use(express.json({ limit: '1mb' }));
  app.use('/api', requireClientHeader);

  app.get('/', (_req, res) => res.redirect('/api'));
  if (options.authRouter) app.use('/api/auth', options.authRouter);

  app.use('/api', (req, res, next) => {
    const workspace = options.workspaces(req);
    if (!workspace) {
      res.status(401).json({ error: { message: 'Oturum açmanız gerekiyor.' } });
      return;
    }
    if (workspace.afterRequest) res.on('finish', () => workspace.afterRequest!());
    workspace.router(req, res, next);
  });
  app.use('/api', notFoundHandler);
  app.use(errorHandler);

  return app;
}
