import { currentMoney } from '../currency/money.js';
import { parseIsoDate } from './dates.js';

const LOCALE = 'tr-TR';

const currencyFormatters = new Map<string, Intl.NumberFormat>();

/** İsteğin gösterim para birimine göre biçimlendirici (bkz. currency/money.ts). */
function currencyFormatter(): Intl.NumberFormat {
  const { display } = currentMoney();
  let formatter = currencyFormatters.get(display);
  if (!formatter) {
    formatter = new Intl.NumberFormat(LOCALE, { style: 'currency', currency: display, maximumFractionDigits: 0 });
    currencyFormatters.set(display, formatter);
  }
  return formatter;
}

const dateFormatter = new Intl.DateTimeFormat(LOCALE, {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  timeZone: 'UTC',
});

/** ₺12.345 (gösterim para birimi USD ise $12.345) */
export function formatCurrency(value: number): string {
  return currencyFormatter().format(Math.round(value));
}

/** 12.345 veya 5,2 */
export function formatNumber(value: number, fractionDigits = 0): string {
  return new Intl.NumberFormat(LOCALE, {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  }).format(value);
}

/**
 * Oranın büyüklüğünü Türkçe yüzde biçiminde verir: 0.284 → "%28".
 * Yön (arttı/azaldı) metinde kelimeyle ifade edildiği için işaret yazılmaz.
 */
export function formatPercent(ratio: number, fractionDigits = 0): string {
  return `%${formatNumber(Math.abs(ratio) * 100, fractionDigits)}`;
}

/** İşaretli yüzde: 0.12 → "+%12", -0.3 → "−%30". */
export function formatSignedPercent(ratio: number, fractionDigits = 0): string {
  const sign = ratio > 0 ? '+' : ratio < 0 ? '−' : '';
  return `${sign}${formatPercent(ratio, fractionDigits)}`;
}

/** İşaretli para: "+₺1.200" / "−₺3.400" */
export function formatSignedCurrency(value: number): string {
  const sign = value > 0 ? '+' : value < 0 ? '−' : '';
  return `${sign}${formatCurrency(Math.abs(value))}`;
}

/** '2026-09-25' → '25.09.2026' */
export function formatDate(value: string): string {
  return dateFormatter.format(parseIsoDate(value));
}
