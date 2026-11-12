import type { DbClient } from '../db/types.js';
import { getSetting, setSetting } from '../repositories/settingsRepository.js';
import { addDays, todayIso } from '../utils/dates.js';
import { CURRENCY_CODES, type CurrencyCode } from './currencies.js';

/** Tarih → (para birimi → 1 EUR karşılığı). Yalnızca kurun yayımlandığı iş günlerini içerir. */
export type RateSeries = Map<string, Partial<Record<CurrencyCode, number>>>;

/** Kur kaynağı. Testlerde sahte bir kaynak verilir; uygulama ağ olmadan da çalışır. */
export interface RateProvider {
  readonly source: string;
  fetchRates(from: string, to: string, currencies: readonly CurrencyCode[]): Promise<RateSeries>;
}

const RATES_URL = 'https://api.frankfurter.dev/v1';
const FETCH_TIMEOUT_MS = 15_000;

/**
 * ECB (Avrupa Merkez Bankası) günlük referans kurları, frankfurter.dev üzerinden. Anahtar gerektirmez
 * ve tüm tarih aralığını tek istekte verir (TCMB arşivi gün başına ayrı istek ister).
 */
export const ecbRateProvider: RateProvider = {
  source: 'Avrupa Merkez Bankası (ECB) referans kurları',
  async fetchRates(from, to, currencies) {
    const symbols = currencies.filter((c) => c !== 'EUR').join(',');
    const response = await fetch(`${RATES_URL}/${from}..${to}?base=EUR&symbols=${symbols}`, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    // Aralıkta henüz yayımlanmış kur yoksa (ör. yalnızca bugün ve bugün hafta sonuysa) servis 404 döner
    if (response.status === 404) return new Map();
    if (!response.ok) throw new Error(`Kur servisi ${response.status} döndürdü.`);
    const body = (await response.json()) as { rates?: Record<string, Partial<Record<CurrencyCode, number>>> };
    return new Map(Object.entries(body.rates ?? {}).map(([date, rates]) => [date, { ...rates, EUR: 1 }]));
  },
};

export class RatesUnavailableError extends Error {
  constructor(cause?: unknown) {
    super('Döviz kurları alınamadı. İnternet bağlantısını kontrol edin veya verileri kendi para biriminde görüntüleyin.', { cause });
    this.name = 'RatesUnavailableError';
  }
}

/** Geçmiş kurlar tamamken en güncel kur için servise en fazla bu sıklıkla gidilir. */
const REFRESH_INTERVAL_MS = 6 * 60 * 60 * 1000;
const CHECKED_AT = 'fx_checked_at';

interface Coverage {
  first: string | null;
  last: string | null;
}

function getCoverage(db: DbClient): Promise<Coverage | undefined> {
  return db.queryOne<Coverage>(`SELECT MIN(rate_date) AS first, MAX(rate_date) AS last FROM fx_rates WHERE currency = 'EUR'`);
}

/**
 * Kurların başlaması gereken tarih: en eski sipariş veya gider; en geç 45 gün önce (gündemdeki 30 günlük
 * kur değişimi sinyali için, veri olmasa da).
 */
async function earliestDataDate(db: DbClient): Promise<string> {
  const row = await db.queryOne<{ first: string | null }>(`
    SELECT MIN(d) AS first FROM (
      SELECT MIN(order_date) AS d FROM orders
      UNION ALL
      SELECT MIN(expense_date) AS d FROM expenses
    ) t`);
  const floor = addDays(todayIso(), -45);
  return row?.first && row.first < floor ? row.first : floor;
}

type DailyRates = [date: string, rates: Partial<Record<CurrencyCode, number>>];

/**
 * Seriyi takvim gününe yayar: kurun yayımlanmadığı günler (hafta sonu, tatil) bir önceki iş gününün,
 * serinin ilk kurundan önceki günler ise ilk kurun değerini alır. Böylece her tarih doğrudan eşleşir.
 */
export function fillDaily(series: RateSeries, from: string): DailyRates[] {
  const dates = [...series.keys()].sort();
  const first = dates[0];
  const last = dates.at(-1);
  if (!first || !last) return [];
  const rows: DailyRates[] = [];
  let carry = series.get(first)!;
  for (let day = from < first ? from : first; day <= last; day = addDays(day, 1)) {
    carry = series.get(day) ?? carry;
    rows.push([day, carry]);
  }
  return rows;
}

async function storeRates(db: DbClient, rows: DailyRates[]): Promise<void> {
  await db.transaction(async (tx) => {
    for (const [date, rates] of rows) {
      for (const [currency, perEur] of Object.entries(rates)) {
        await tx.execute(
          `INSERT INTO fx_rates (currency, rate_date, per_eur) VALUES (?, ?, ?)
           ON CONFLICT (currency, rate_date) DO UPDATE SET per_eur = excluded.per_eur`,
          [currency, date, perEur],
        );
      }
    }
  });
}

/** Veritabanı başına devam eden kur güncellemesi (eşzamanlı istekler aynı çekimi bekler). */
const pending = new WeakMap<DbClient, Promise<void>>();

/**
 * Verilerin tarih aralığını kapsayan kurların veritabanında olmasını sağlar. Eksikse kaynaktan çekip
 * saklar; aynı anda gelen istekler tek bir çekimi bekler. Kaynağa ulaşılamazsa ve elde hiç kur yoksa
 * RatesUnavailableError fırlatır; daha eski kurlar varsa onlarla devam edilir.
 */
export function ensureRates(db: DbClient, provider: RateProvider): Promise<void> {
  let refresh = pending.get(db);
  if (!refresh) {
    refresh = refreshRates(db, provider).finally(() => pending.delete(db));
    pending.set(db, refresh);
  }
  return refresh;
}

async function refreshRates(db: DbClient, provider: RateProvider): Promise<void> {
  const [coverage, needFrom, checkedAt] = await Promise.all([getCoverage(db), earliestDataDate(db), getSetting(db, CHECKED_AT)]);
  const today = todayIso();
  const missingHistory = !coverage?.first || needFrom < coverage.first;
  const stale = !coverage?.last || (coverage.last < today && Date.now() - Number(checkedAt ?? 0) > REFRESH_INTERVAL_MS);
  if (!missingHistory && !stale) return;

  // Bir hafta öncesinden başla: aralık hafta sonu veya tatille başlasa bile önceki iş gününün kuru gelir
  const from = addDays(missingHistory || !coverage?.last ? needFrom : coverage.last, -7);
  try {
    const series = await provider.fetchRates(from, today, CURRENCY_CODES);
    await storeRates(db, fillDaily(series, from));
    await setSetting(db, CHECKED_AT, String(Date.now()));
  } catch (error) {
    if (!coverage?.last) throw new RatesUnavailableError(error);
    console.warn(`[kur] Güncel kurlar alınamadı, ${coverage.last} tarihli kurlarla devam ediliyor:`, error);
  }
}

export interface LatestRate {
  /** 1 birim ana para biriminin gösterim para birimindeki karşılığı */
  factor: number;
  date: string;
}

/** En son kur tarihindeki çevrim katsayısı (ürün maliyeti ve stok değeri gibi tarihsiz tutarlar için). */
export async function getLatestFactor(db: DbClient, base: CurrencyCode, display: CurrencyCode): Promise<LatestRate | null> {
  const row = await db.queryOne<LatestRate>(
    `
    SELECT d.per_eur / b.per_eur AS factor, b.rate_date AS date
    FROM fx_rates b
    JOIN fx_rates d ON d.rate_date = b.rate_date AND d.currency = ?
    WHERE b.currency = ?
    ORDER BY b.rate_date DESC
    LIMIT 1`,
    [display, base],
  );
  return row ?? null;
}
