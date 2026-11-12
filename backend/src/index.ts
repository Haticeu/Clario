import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createApp } from './app.js';
import { createGoogleProvider } from './auth/google.js';
import { AuthService } from './auth/service.js';
import { env } from './config/env.js';
import { ecbRateProvider } from './currency/rates.js';
import { createSqliteClient } from './db/sqlite.js';
import { createAuthRouter } from './http/authRoutes.js';
import { fetchFeed } from './news/rss.js';
import { fetchArticle } from './news/article.js';
import { createNewsService } from './news/service.js';

// Şifreli çalışma alanları, veritabanını bellekte açıp kapatabilmeyi (serialize/deserialize) gerektirir
if (typeof DatabaseSync.prototype.serialize !== 'function') {
  console.error(`Clario, Node.js 24 veya üstünü gerektirir (şu an: ${process.version}). https://nodejs.org adresinden güncelleyin.`);
  process.exit(1);
}

// Hesap kayıtları (kişisel veri içermez); her hesabın verisi ayrı ve şifreli dosyada
const system = createSqliteClient(path.join(env.dataDir, 'system.db'));
const auth = await AuthService.create(system, {
  dataDir: env.dataDir,
  cookieSecure: env.cookieSecure,
  lockoutMinutes: env.loginLockoutMinutes,
  services: { rates: ecbRateProvider, news: createNewsService({ fetchFeed, fetchArticle, rates: ecbRateProvider }) },
  google:
    env.googleClientId && env.googleClientSecret
      ? {
          appUrl: env.appUrl,
          provider: createGoogleProvider({
            clientId: env.googleClientId,
            clientSecret: env.googleClientSecret,
            redirectUri: `${env.appUrl}/api/auth/google/callback`,
          }),
        }
      : undefined,
});
const app = createApp({
  workspaces: auth.resolve,
  authRouter: createAuthRouter(auth, { rateLimitMinutes: env.loginLockoutMinutes }),
  corsOrigins: env.corsOrigins,
  trustProxy: env.trustProxy,
});

// Express 5, dinleme hatalarını (ör. port dolu) callback'e iletir.
const server = app.listen(env.port, async (error?: Error & { code?: string }) => {
  if (error) {
    const hint =
      error.code === 'EADDRINUSE'
        ? `Port ${env.port} başka bir uygulama tarafından kullanılıyor. O uygulamayı kapatın veya ` +
          'farklı bir port seçin (ör. backend/.env içinde PORT=4100).'
        : error.message;
    console.error(`API başlatılamadı: ${hint}`);
    await system.close();
    process.exit(1);
  }

  console.log(`Clario API    → http://localhost:${env.port}/api`);
  console.log(`Veri klasörü  → ${env.dataDir} (hesap verileri şifreli)`);
  console.log(
    env.googleClientId && env.googleClientSecret
      ? `Google girişi → açık (dönüş adresi: ${env.appUrl}/api/auth/google/callback)`
      : 'Google girişi → kapalı (açmak için backend/.env: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET)',
  );
});

function shutdown(signal: string) {
  console.log(`\n${signal} alındı, sunucu kapatılıyor…`);
  server.close(() => {
    // Açık oturumların verisi şifreli olarak diske yazılır, anahtarlar bellekten silinir
    void auth
      .closeAll()
      .then(() => system.close())
      .then(() => process.exit(0));
  });
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
