import { isCurrency, type CurrencyCode } from './currencies.js';

/**
 * Ülke (ISO 3166-1 alfa-2) → yerel para birimi (ISO 4217). Kayıtta seçilen ülkeye göre verilerin para birimi
 * otomatik belirlenir. Yerel para birimi kur kaynağında yoksa (ör. SAR, AED) ABD doları önerilir.
 */
const COUNTRY_CURRENCY: Record<string, string> = {
  AD: 'EUR', AE: 'AED', AF: 'AFN', AG: 'XCD', AL: 'ALL', AM: 'AMD', AO: 'AOA', AR: 'ARS', AT: 'EUR', AU: 'AUD',
  AZ: 'AZN', BA: 'BAM', BB: 'BBD', BD: 'BDT', BE: 'EUR', BF: 'XOF', BG: 'EUR', BH: 'BHD', BI: 'BIF', BJ: 'XOF',
  BN: 'BND', BO: 'BOB', BR: 'BRL', BS: 'BSD', BT: 'BTN', BW: 'BWP', BY: 'BYN', BZ: 'BZD', CA: 'CAD', CD: 'CDF',
  CF: 'XAF', CG: 'XAF', CH: 'CHF', CI: 'XOF', CL: 'CLP', CM: 'XAF', CN: 'CNY', CO: 'COP', CR: 'CRC', CU: 'CUP',
  CV: 'CVE', CY: 'EUR', CZ: 'CZK', DE: 'EUR', DJ: 'DJF', DK: 'DKK', DM: 'XCD', DO: 'DOP', DZ: 'DZD', EC: 'USD',
  EE: 'EUR', EG: 'EGP', ER: 'ERN', ES: 'EUR', ET: 'ETB', FI: 'EUR', FJ: 'FJD', FM: 'USD', FR: 'EUR', GA: 'XAF',
  GB: 'GBP', GD: 'XCD', GE: 'GEL', GH: 'GHS', GM: 'GMD', GN: 'GNF', GQ: 'XAF', GR: 'EUR', GT: 'GTQ', GW: 'XOF',
  GY: 'GYD', HK: 'HKD', HN: 'HNL', HR: 'EUR', HT: 'HTG', HU: 'HUF', ID: 'IDR', IE: 'EUR', IL: 'ILS', IN: 'INR',
  IQ: 'IQD', IR: 'IRR', IS: 'ISK', IT: 'EUR', JM: 'JMD', JO: 'JOD', JP: 'JPY', KE: 'KES', KG: 'KGS', KH: 'KHR',
  KI: 'AUD', KM: 'KMF', KN: 'XCD', KP: 'KPW', KR: 'KRW', KW: 'KWD', KZ: 'KZT', LA: 'LAK', LB: 'LBP', LC: 'XCD',
  LI: 'CHF', LK: 'LKR', LR: 'LRD', LS: 'LSL', LT: 'EUR', LU: 'EUR', LV: 'EUR', LY: 'LYD', MA: 'MAD', MC: 'EUR',
  MD: 'MDL', ME: 'EUR', MG: 'MGA', MH: 'USD', MK: 'MKD', ML: 'XOF', MM: 'MMK', MN: 'MNT', MO: 'MOP', MR: 'MRU',
  MT: 'EUR', MU: 'MUR', MV: 'MVR', MW: 'MWK', MX: 'MXN', MY: 'MYR', MZ: 'MZN', NA: 'NAD', NE: 'XOF', NG: 'NGN',
  NI: 'NIO', NL: 'EUR', NO: 'NOK', NP: 'NPR', NR: 'AUD', NZ: 'NZD', OM: 'OMR', PA: 'PAB', PE: 'PEN', PG: 'PGK',
  PH: 'PHP', PK: 'PKR', PL: 'PLN', PR: 'USD', PS: 'ILS', PT: 'EUR', PW: 'USD', PY: 'PYG', QA: 'QAR', RO: 'RON',
  RS: 'RSD', RU: 'RUB', RW: 'RWF', SA: 'SAR', SB: 'SBD', SC: 'SCR', SD: 'SDG', SE: 'SEK', SG: 'SGD', SI: 'EUR',
  SK: 'EUR', SL: 'SLE', SM: 'EUR', SN: 'XOF', SO: 'SOS', SR: 'SRD', SS: 'SSP', ST: 'STN', SV: 'USD', SY: 'SYP',
  SZ: 'SZL', TD: 'XAF', TG: 'XOF', TH: 'THB', TJ: 'TJS', TL: 'USD', TM: 'TMT', TN: 'TND', TO: 'TOP', TR: 'TRY',
  TT: 'TTD', TV: 'AUD', TW: 'TWD', TZ: 'TZS', UA: 'UAH', UG: 'UGX', US: 'USD', UY: 'UYU', UZ: 'UZS', VA: 'EUR',
  VC: 'XCD', VE: 'VES', VN: 'VND', VU: 'VUV', WS: 'WST', XK: 'EUR', YE: 'YER', ZA: 'ZAR', ZM: 'ZMW', ZW: 'ZWG',
};

/** Yerel para birimi kur kaynağında yoksa önerilen para birimi */
const FALLBACK_CURRENCY: CurrencyCode = 'USD';

export const COUNTRY_CODES = Object.keys(COUNTRY_CURRENCY).sort();

export function isCountry(value: unknown): value is string {
  return typeof value === 'string' && Object.hasOwn(COUNTRY_CURRENCY, value);
}

export interface CountryCurrency {
  /** Verilerin para birimi olarak önerilen (desteklenen) para birimi */
  currency: CurrencyCode;
  /** Ülkenin yerel para birimi; destekleniyorsa currency ile aynı */
  native: string;
}

export function currencyForCountry(country: string): CountryCurrency {
  const native = COUNTRY_CURRENCY[country] ?? FALLBACK_CURRENCY;
  return { currency: isCurrency(native) ? native : FALLBACK_CURRENCY, native };
}

const regionNames = new Intl.DisplayNames('tr', { type: 'region' });

/** Ülkenin Türkçe adı: 'TR' → 'Türkiye' */
export function countryName(code: string): string {
  return regionNames.of(code) ?? code;
}
