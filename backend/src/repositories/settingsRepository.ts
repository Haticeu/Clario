import { DEFAULT_CURRENCY, isCurrency, type CurrencyCode } from '../currency/currencies.js';
import type { DbClient } from '../db/types.js';

const BASE_CURRENCY = 'base_currency';

export async function getSetting(db: DbClient, key: string): Promise<string | null> {
  const row = await db.queryOne<{ value: string }>('SELECT value FROM settings WHERE key = ?', [key]);
  return row?.value ?? null;
}

export async function setSetting(db: DbClient, key: string, value: string): Promise<void> {
  await db.execute(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value',
    [key, value],
  );
}

/** Verilerin (fiyat, maliyet, gider) girildiği para birimi. */
export async function getBaseCurrency(db: DbClient): Promise<CurrencyCode> {
  const value = await getSetting(db, BASE_CURRENCY);
  return isCurrency(value) ? value : DEFAULT_CURRENCY;
}

export function setBaseCurrency(db: DbClient, currency: CurrencyCode): Promise<void> {
  return setSetting(db, BASE_CURRENCY, currency);
}
