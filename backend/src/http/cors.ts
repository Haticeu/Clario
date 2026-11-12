import type { RequestHandler } from 'express';

/** 'localhost' → yerel geliştirme: http://localhost:* ve http://127.0.0.1:* */
export type CorsPolicy = readonly string[] | 'localhost';

const LOCAL_ORIGIN = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;

function isAllowed(origin: string, policy: CorsPolicy): boolean {
  return policy === 'localhost' ? LOCAL_ORIGIN.test(origin) : policy.includes(origin);
}

/**
 * Minimal CORS: yalnızca izin verilen adreslerden (ör. Vite geliştirme sunucusu) gelen
 * tarayıcı isteklerine izin verir. Ön kontrol (OPTIONS) istekleri burada yanıtlanır.
 */
export function cors(policy: CorsPolicy): RequestHandler {
  return (req, res, next) => {
    const origin = req.headers.origin;
    if (origin && isAllowed(origin, policy)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Clario-Mapping, X-Clario-Currency, X-Clario-Client');
      // Oturum çerezi yalnızca açıkça izin verilen adreslerden gelen isteklerde kullanılabilir
      res.setHeader('Access-Control-Allow-Credentials', 'true');
      res.setHeader('Access-Control-Max-Age', '600');
    }
    res.setHeader('Vary', 'Origin');
    if (req.method === 'OPTIONS') {
      res.sendStatus(204);
      return;
    }
    next();
  };
}
