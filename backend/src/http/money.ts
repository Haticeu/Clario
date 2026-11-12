import type { Request, RequestHandler } from 'express';
import { isCurrency } from '../currency/currencies.js';
import { identityMoney, resolveMoney, runWithMoney } from '../currency/money.js';
import type { RateProvider } from '../currency/rates.js';
import type { DbClient } from '../db/types.js';
import { getBaseCurrency } from '../repositories/settingsRepository.js';
import { HttpError } from './errors.js';

/** İstenen gösterim para birimi: `X-Clario-Currency` başlığı veya `?currency=USD`. */
function requestedCurrency(req: Request): string | undefined {
  const header = req.get('x-clario-currency');
  if (header) return header.toUpperCase();
  return typeof req.query.currency === 'string' ? req.query.currency.toUpperCase() : undefined;
}

/**
 * Analiz endpoint'leri için: tutarlar istenen para birimine, her kaydın kendi tarihindeki kurla
 * çevrilir. Kurlar gerekiyorsa önce güncellenir. Para birimi istenmezse veriler ana para
 * biriminde döner.
 */
export function convertedMoney(db: DbClient, provider: RateProvider): RequestHandler {
  return async (req, _res, next) => {
    const requested = requestedCurrency(req);
    if (requested !== undefined && !isCurrency(requested)) {
      throw new HttpError(400, `Desteklenmeyen para birimi: ${requested}`);
    }
    const base = await getBaseCurrency(db);
    const money = await resolveMoney(db, provider, base, requested ?? base);
    runWithMoney(money, next);
  };
}

/** Veri girişi endpoint'leri için: kayıtlar her zaman girildikleri (ana) para biriminde okunur ve yazılır. */
export function baseMoney(db: DbClient): RequestHandler {
  return async (_req, _res, next) => {
    runWithMoney(identityMoney(await getBaseCurrency(db)), next);
  };
}
