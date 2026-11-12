import type { Request, RequestHandler } from 'express';
import { HttpError } from './errors.js';

/**
 * API yanıtları için güvenlik başlıkları. API yalnızca JSON ve dosya döndürdüğü için içerik politikası
 * en kısıtlı haldedir; yanıtlar önbelleğe alınmaz (kişisel/finansal veri tarayıcı önbelleğinde kalmasın).
 */
export const securityHeaders: RequestHandler = (_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  res.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'");
  res.setHeader('Cache-Control', 'no-store');
  next();
};

export const CLIENT_HEADER = 'x-clario-client';
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * CSRF koruması: veri değiştiren her istek özel bir başlık taşımalıdır. Başka bir sitedeki form veya bağlantı
 * bu başlığı ekleyemez; ekleyen bir betik ise CORS ön kontrolüne takılır. (Oturum çerezi ayrıca SameSite=Strict.)
 */
export const requireClientHeader: RequestHandler = (req, _res, next) => {
  if (SAFE_METHODS.has(req.method) || req.get(CLIENT_HEADER)) return next();
  next(new HttpError(403, 'İstek reddedildi (eksik istemci başlığı).'));
};

interface Bucket {
  count: number;
  resetAt: number;
}

/**
 * Basit IP tabanlı sınırlama (bellekte, sabit pencere). Giriş/kayıt gibi pahalı ve kaba kuvvete açık
 * endpoint'lerde kullanılır; hesap bazında ayrıca 5 hatalı denemede kilitleme vardır.
 */
export function rateLimit({ limit, windowMs, message }: { limit: number; windowMs: number; message: string }): RequestHandler {
  const buckets = new Map<string, Bucket>();
  const key = (req: Request) => req.ip ?? req.socket.remoteAddress ?? 'unknown';
  return (req, res, next) => {
    const now = Date.now();
    if (buckets.size > 10_000) for (const [k, b] of buckets) if (b.resetAt <= now) buckets.delete(k);
    const bucket = buckets.get(key(req));
    if (!bucket || bucket.resetAt <= now) {
      buckets.set(key(req), { count: 1, resetAt: now + windowMs });
      return next();
    }
    if (++bucket.count > limit) {
      res.setHeader('Retry-After', String(Math.ceil((bucket.resetAt - now) / 1000)));
      return next(new HttpError(429, message));
    }
    next();
  };
}
