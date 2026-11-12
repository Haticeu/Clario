/**
 * Desteklenen para birimleri: ECB'nin günlük referans kuru yayımladığı tüm para birimleri (kurla çevrim
 * yalnızca bunlar arasında yapılabilir). Türkçe adlar ve simgeler Intl'den türetilir.
 */
export const CURRENCY_CODES = [
  'TRY', 'USD', 'EUR', 'GBP', 'CHF', 'JPY', 'CNY', 'AUD', 'CAD', 'NZD',
  'SEK', 'NOK', 'DKK', 'ISK', 'PLN', 'CZK', 'HUF', 'RON', 'ILS', 'INR',
  'IDR', 'KRW', 'MYR', 'PHP', 'SGD', 'THB', 'HKD', 'BRL', 'MXN', 'ZAR',
] as const;

export type CurrencyCode = (typeof CURRENCY_CODES)[number];

export const DEFAULT_CURRENCY: CurrencyCode = 'TRY';

const names = new Intl.DisplayNames('tr', { type: 'currency' });

function symbolOf(code: string): string {
  const part = new Intl.NumberFormat('tr-TR', { style: 'currency', currency: code, currencyDisplay: 'narrowSymbol' })
    .formatToParts(0)
    .find((p) => p.type === 'currency');
  return part?.value ?? code;
}

export const CURRENCIES: Record<CurrencyCode, { label: string; symbol: string }> = Object.fromEntries(
  CURRENCY_CODES.map((code) => [code, { label: names.of(code) ?? code, symbol: symbolOf(code) }]),
) as Record<CurrencyCode, { label: string; symbol: string }>;

export function isCurrency(value: unknown): value is CurrencyCode {
  return typeof value === 'string' && (CURRENCY_CODES as readonly string[]).includes(value);
}
