import { AsyncLocalStorage } from 'node:async_hooks';
import type { DbClient } from '../db/types.js';
import { DEFAULT_CURRENCY, isCurrency, type CurrencyCode } from './currencies.js';
import { ensureRates, getLatestFactor, RatesUnavailableError, type RateProvider } from './rates.js';

/**
 * Bir isteğin para birimi bağlamı. Veriler ana para biriminde (base) saklanır; analizler
 * gösterim para biriminde (display) hesaplanır. Çevrim veritabanından okurken yapıldığı için
 * analiz ve asistan kodu para biriminden habersizdir.
 */
export interface MoneyContext {
  base: CurrencyCode;
  display: CurrencyCode;
  /** Tarihsiz tutarlar (ürün maliyeti/fiyatı, stok değeri) ve kuru bulunmayan günler için son kur */
  latestFactor: number;
  /** Son kurun tarihi; çevrim yoksa null */
  rateDate: string | null;
  source: string | null;
}

const storage = new AsyncLocalStorage<MoneyContext>();

export function identityMoney(currency: CurrencyCode = DEFAULT_CURRENCY): MoneyContext {
  return { base: currency, display: currency, latestFactor: 1, rateDate: null, source: null };
}

/** İstek dışında (betikler, testler) TRY varsayılır ve çevrim yapılmaz. */
export function currentMoney(): MoneyContext {
  return storage.getStore() ?? identityMoney();
}

export function runWithMoney<T>(money: MoneyContext, work: () => T): T {
  return storage.run(money, work);
}

/** Ana para birimi ile gösterim para birimi için bağlam kurar; gerekirse kurları günceller. */
export async function resolveMoney(
  db: DbClient,
  provider: RateProvider,
  base: CurrencyCode,
  display: CurrencyCode,
): Promise<MoneyContext> {
  if (base === display) return identityMoney(base);
  await ensureRates(db, provider);
  const latest = await getLatestFactor(db, base, display);
  if (!latest) throw new RatesUnavailableError();
  return { base, display, latestFactor: latest.factor, rateDate: latest.date, source: provider.source };
}

/**
 * Bir tutarı, dateExpr sütunundaki günün kuruyla gösterim para birimine çeviren SQL çarpanı.
 * Kullanım: `oi.unit_price * ${fxFactor('o.order_date')}`. Para birimi kodları beyaz listeden
 * geldiği için SQL'e doğrudan yazılır; böylece sorgunun `?` parametre sırası değişmez.
 */
export function fxFactor(dateExpr: string): string {
  const { base, display, latestFactor } = currentMoney();
  if (base === display) return '1';
  if (!isCurrency(base) || !isCurrency(display) || !Number.isFinite(latestFactor)) {
    throw new Error('Geçersiz para birimi bağlamı');
  }
  return `COALESCE((
      SELECT d.per_eur / b.per_eur FROM fx_rates b
      JOIN fx_rates d ON d.rate_date = b.rate_date AND d.currency = '${display}'
      WHERE b.currency = '${base}' AND b.rate_date = ${dateExpr}
    ), ${latestFactor})`;
}

/** Tarihsiz bir tutarı (ör. ürünün güncel maliyeti) son kurla çevirir. */
export function convertLatest(amount: number): number {
  return amount * currentMoney().latestFactor;
}
