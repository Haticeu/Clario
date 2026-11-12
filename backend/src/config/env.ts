import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// src/config (dev) ve dist/config (build) aynı derinlikte: iki üst klasör backend köküdür.
const backendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

// Opsiyonel backend/.env dosyası (bkz. .env.example). Ortamda zaten tanımlı değişkenler ezilmez.
const envFile = path.join(backendRoot, '.env');
if (fs.existsSync(envFile)) process.loadEnvFile(envFile);

function readPort(): number {
  const raw = process.env.PORT ?? '4000';
  const port = Number(raw);
  if (!Number.isInteger(port) || port <= 0 || port > 65_535) {
    throw new Error(`Geçersiz PORT değeri: "${raw}" (1–65535 arasında bir tam sayı olmalı)`);
  }
  return port;
}

const dataDir = path.resolve(backendRoot, process.env.DATA_DIR ?? 'data');

export const env = {
  port: readPort(),
  /**
   * Veri klasörü: hesaplar (system.db, kişisel veri içermez), sunucu anahtarı (server.key) ve her hesabın
   * şifreli çalışma alanı (users/<id>.clario). Göreli yollar backend klasörüne göre çözülür.
   */
  dataDir,
  /**
   * Analiz motorunu doğrulamak için üretilen test verisinin veritabanı (npm run seed / verify).
   * Gerçek veritabanına asla test verisi yazılmaz.
   */
  testDatabasePath: path.resolve(backendRoot, process.env.TEST_DATABASE_PATH ?? path.join('data', 'test.db')),
  /**
   * Frontend'e başka bir adresten (farklı origin) erişilecekse izin verilen adresler, virgülle ayrılmış.
   * Varsayılan: hiçbiri. Geliştirmede ve üretimde frontend API'ye aynı adres üzerinden (Vite proxy veya
   * ters vekil) eriştiği için gerekmez; gereksiz izin, oturum çerezinin başka sitelerce kullanılma riskini artırır.
   */
  corsOrigins: (process.env.CORS_ORIGINS ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean),
  /**
   * Oturum çerezinin Secure bayrağı: 'true' → yalnızca HTTPS, 'false' → her zaman gönder,
   * tanımsız → istek HTTPS ise. İnternete açık kurulumlarda HTTPS arkasında 'true' yapın.
   */
  cookieSecure: process.env.COOKIE_SECURE === 'true' ? true : process.env.COOKIE_SECURE === 'false' ? false : ('auto' as const),
  /**
   * Hatalı giriş koruması (dakika). 0 (varsayılan): kapalı. Örn. 15: 5 hatalı parolada hesap 15 dakika kilitlenir
   * ve aynı IP'den 15 dakikada en fazla 20 giriş/kayıt/kurtarma denemesi yapılabilir. İnternete açık kurulumda açın.
   */
  loginLockoutMinutes: Math.max(0, Number(process.env.LOGIN_LOCKOUT_MINUTES ?? 0) || 0),
  /** Ters vekil (nginx, Caddy…) arkasında çalışıyorsa 'true': HTTPS ve istemci IP'si vekilden okunur */
  trustProxy: process.env.TRUST_PROXY === 'true',
  /**
   * Arayüzün tarayıcıda açıldığı adres. Google girişinden dönüş adresi bundan üretilir:
   * <APP_URL>/api/auth/google/callback (Google Cloud Console'a bu adres eklenir).
   */
  appUrl: (process.env.APP_URL ?? 'http://localhost:5180').replace(/\/+$/, ''),
  /** Google ile giriş için OAuth istemcisi (ikisi de tanımlıysa "Google ile devam et" düğmesi görünür) */
  googleClientId: process.env.GOOGLE_CLIENT_ID?.trim() || null,
  googleClientSecret: process.env.GOOGLE_CLIENT_SECRET?.trim() || null,
} as const;
