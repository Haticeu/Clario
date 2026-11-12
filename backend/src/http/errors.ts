import type { ErrorRequestHandler, RequestHandler } from 'express';
import { NoDataError } from '../analysis/context.js';
import { RatesUnavailableError } from '../currency/rates.js';
import { FieldError } from '../data/validation.js';
import { WorkbookReadError } from '../import/mapping.js';

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

export const notFoundHandler: RequestHandler = (req, res) => {
  res.status(404).json({ error: { message: `Endpoint bulunamadı: ${req.method} ${req.originalUrl}` } });
};

/**
 * Merkezi hata yönetimi. Express 5, async route'larda fırlatılan (veya reddedilen) her hatayı
 * buraya iletir; bu yüzden route'lar ayrı ayrı try/catch ile sarılmaz. Tüm hatalar tutarlı
 * `{ error: { message } }` biçimine çevrilir:
 *  - HttpError → kendi durum kodu (ör. 400 geçersiz girdi)
 *  - FieldError / WorkbookReadError → 400 (geçersiz alan, okunamayan Excel dosyası)
 *  - NoDataError → 503 ve veri girişi yönlendirmesi
 *  - RatesUnavailableError → 502 (kur servisine ulaşılamıyor; 503 "veri yok" anlamında kullanıldığı için ayrı)
 *  - Çok büyük istek gövdesi → 413
 *  - Geçersiz JSON gövdesi → 400
 *  - Diğer her şey → 500; ayrıntı yalnızca sunucu loguna yazılır, istemciye iç hata sızdırılmaz
 */
export const errorHandler: ErrorRequestHandler = (error, req, res, _next) => {
  if (error instanceof HttpError) {
    res.status(error.status).json({ error: { message: error.message } });
    return;
  }
  if (error instanceof FieldError || error instanceof WorkbookReadError) {
    res.status(400).json({ error: { message: error.message } });
    return;
  }
  if (error?.type === 'entity.too.large') {
    res.status(413).json({ error: { message: 'Dosya çok büyük (en fazla 25 MB).' } });
    return;
  }
  if (error instanceof RatesUnavailableError) {
    res.status(502).json({ error: { message: error.message } });
    return;
  }
  if (error instanceof NoDataError) {
    res.status(503).json({ error: { message: error.message } });
    return;
  }
  // express.json() geçersiz JSON gövdesinde type = 'entity.parse.failed' ile hata fırlatır
  if (error?.type === 'entity.parse.failed') {
    res.status(400).json({ error: { message: 'İstek gövdesi geçerli bir JSON değil.' } });
    return;
  }
  const route = `${req.method} ${req.originalUrl}`;
  console.error(`[${new Date().toISOString()}] ${route} başarısız:`, error);
  res.status(500).json({
    error: { message: `Beklenmeyen bir sunucu hatası oluştu (${route}). Ayrıntılar sunucu logunda.` },
  });
};
