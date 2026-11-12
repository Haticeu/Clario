/**
 * Kullanıcı girdisi doğrulama yardımcıları. Hem uygulama içi formlar (JSON) hem Excel
 * içe aktarımı için kullanılır; bu yüzden Excel'in ürettiği tipleri de (Date, sayı,
 * "1.234,56" gibi Türkçe biçimli metin) kabul eder.
 */

/** Tek bir alanın hatası; mesaj doğrudan kullanıcıya gösterilir. */
export class FieldError extends Error {
  constructor(
    readonly field: string,
    message: string,
  ) {
    super(message);
    this.name = 'FieldError';
  }
}

const TURKISH_FOLD: Record<string, string> = { ç: 'c', ğ: 'g', ı: 'i', ö: 'o', ş: 's', ü: 'u', â: 'a', î: 'i', û: 'u' };

/** Karşılaştırma anahtarı: Türkçe küçük harf, aksansız, tek boşluk. "  İSTANBUL " → "istanbul" */
export function matchKey(value: string): string {
  return value
    .toLocaleLowerCase('tr-TR')
    .replace(/[çğıöşüâîû]/g, (ch) => TURKISH_FOLD[ch] ?? ch)
    .replace(/\s+/g, ' ')
    .trim();
}

function isBlank(value: unknown): boolean {
  return value === null || value === undefined || (typeof value === 'string' && value.trim() === '');
}

export function optionalText(value: unknown, label: string, maxLength = 200): string | null {
  if (isBlank(value)) return null;
  const text = String(value).replace(/\s+/g, ' ').trim();
  if (text.length > maxLength) throw new FieldError(label, `${label} en fazla ${maxLength} karakter olabilir.`);
  return text;
}

export function requiredText(value: unknown, label: string, maxLength = 200): string {
  const text = optionalText(value, label, maxLength);
  if (text === null) throw new FieldError(label, `${label} zorunludur.`);
  return text;
}

/** "1.234,56" · "1234,56" · "1,234.56" · "₺ 1.500" · 42 → sayı */
function parseNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string') return null;
  let text = value.replace(/[₺\s]|TL|TRY/gi, '');
  if (text === '') return null;
  const lastComma = text.lastIndexOf(',');
  const lastDot = text.lastIndexOf('.');
  if (lastComma > -1 && lastDot > -1) {
    // Son ayraç ondalıktır: "1.234,56" (TR) veya "1,234.56" (EN)
    text = lastComma > lastDot ? text.replace(/\./g, '').replace(',', '.') : text.replace(/,/g, '');
  } else if (lastComma > -1) {
    text = text.replace(',', '.');
  } else if (/^-?\d{1,3}(\.\d{3})+$/.test(text)) {
    text = text.replace(/\./g, ''); // "1.500" → binlik ayraç
  }
  const number = Number(text);
  return Number.isFinite(number) ? number : null;
}

interface NumberOptions {
  min?: number;
  integer?: boolean;
}

export function optionalNumber(value: unknown, label: string, options: NumberOptions = {}): number | null {
  if (isBlank(value)) return null;
  const number = parseNumber(value);
  if (number === null) throw new FieldError(label, `${label} geçerli bir sayı değil ("${String(value)}").`);
  if (options.integer && !Number.isInteger(number)) throw new FieldError(label, `${label} tam sayı olmalıdır.`);
  if (options.min !== undefined && number < options.min) {
    throw new FieldError(label, `${label} en az ${options.min} olmalıdır.`);
  }
  return Math.round(number * 100) / 100;
}

export function requiredNumber(value: unknown, label: string, options: NumberOptions = {}): number {
  const number = optionalNumber(value, label, options);
  if (number === null) throw new FieldError(label, `${label} zorunludur.`);
  return number;
}

const pad = (n: number) => String(n).padStart(2, '0');

/** Ay adları (aksansız, küçük harf; kısaltma ile eşleşmek için önek olarak kullanılır) */
const MONTHS = [
  ['oca', 'jan'], ['sub', 'feb'], ['mar'], ['nis', 'apr'], ['may'], ['haz', 'jun'],
  ['tem', 'jul'], ['agu', 'aug'], ['eyl', 'sep'], ['eki', 'oct'], ['kas', 'nov'], ['ara', 'dec'],
];

/** "26" → 2026 */
const fullYear = (year: string) => (year.length === 2 ? 2000 + Number(year) : Number(year));

function validDate(year: number, month: number, day: number): string | null {
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  if (year < 1990 || year > 2100) return null;
  return `${year}-${pad(month)}-${pad(day)}`;
}

/** Date · Excel seri numarası · "2026-09-25" · "25.09.2026" · "25/09/2026" → "2026-09-25" */
function parseDate(value: unknown): string | null {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime())
      ? null
      : validDate(value.getUTCFullYear(), value.getUTCMonth() + 1, value.getUTCDate());
  }
  if (typeof value === 'number') {
    // Excel seri tarihi (1900 sistemi): 25569 = 1970-01-01
    return parseDate(new Date(Math.round((value - 25_569) * 86_400_000)));
  }
  if (typeof value !== 'string') return null;
  const text = value.trim();
  // 2026-09-25 · 2026/09/25 (ardından saat olabilir)
  let match = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[ T].*)?$/.exec(text);
  if (match) return validDate(Number(match[1]), Number(match[2]), Number(match[3]));
  // 25.09.2026 · 25/09/2026 · 25-09-26 (ardından saat olabilir)
  match = /^(\d{1,2})[./-](\d{1,2})[./-](\d{2}|\d{4})(?:\s.*)?$/.exec(text);
  if (match) return validDate(fullYear(match[3]!), Number(match[2]), Number(match[1]));
  // 25 Eylül 2026 · 25-Eyl-26 · 25 Sep 2026
  match = /^(\d{1,2})[\s.-]+([a-zçğıöşü]+)[\s.,-]+(\d{2}|\d{4})(?:\s.*)?$/i.exec(text);
  if (match) {
    const month = MONTHS.findIndex((names) => names.some((n) => matchKey(match![2]!).startsWith(n)));
    if (month >= 0) return validDate(fullYear(match[3]!), month + 1, Number(match[1]));
  }
  return null;
}

export function optionalDate(value: unknown, label: string): string | null {
  if (isBlank(value)) return null;
  const date = parseDate(value);
  if (!date) throw new FieldError(label, `${label} geçerli bir tarih değil ("${String(value)}"). Örnek: 25.09.2026`);
  return date;
}

export function requiredDate(value: unknown, label: string): string {
  const date = optionalDate(value, label);
  if (date === null) throw new FieldError(label, `${label} zorunludur.`);
  return date;
}

/** Serbest yazımı sabit değerlerden birine eşler: "bayi", "BAYİ" → "Bayi" */
export function oneOf<T extends string>(
  value: unknown,
  label: string,
  choices: Record<T, readonly string[]>,
  fallback?: T,
): T {
  if (isBlank(value)) {
    if (fallback !== undefined) return fallback;
    throw new FieldError(label, `${label} zorunludur.`);
  }
  const key = matchKey(String(value));
  for (const [choice, aliases] of Object.entries(choices) as [T, readonly string[]][]) {
    if (aliases.some((alias) => matchKey(alias) === key)) return choice;
  }
  const allowed = (Object.values(choices) as readonly string[][]).map((aliases) => aliases[0]).join(', ');
  throw new FieldError(label, `${label} şunlardan biri olmalıdır: ${allowed} ("${String(value)}").`);
}

export const CUSTOMER_TYPES = { Bayi: ['Bayi', 'bayi', 'dealer'], Mağaza: ['Mağaza', 'magaza', 'store'] } as const;

export const ORDER_STATUSES = {
  delivered: ['Teslim edildi', 'teslim', 'tamamlandı', 'delivered'],
  cancelled: ['İptal', 'iptal edildi', 'cancelled', 'canceled'],
} as const;
