import type { StatementKind } from '../analysis/statement.js';
import { monthPeriod } from '../analysis/statement.js';
import type { Period } from '../repositories/reportRepository.js';
import { addDays } from '../utils/dates.js';
import { normalizeText } from './text.js';

/**
 * Asistandan rapor/ekstre isteği: "Eylül raporunu istiyorum", "dünün raporu", "15 Ekim gün sonu raporu",
 * "son 7 günün özeti", "geçen ayın ekstresi excel". Dönem ve (istenirse) dosya biçimi metinden çıkarılır.
 */

export type StatementFormat = 'excel' | 'pdf' | 'word';

export interface StatementRequest {
  kind: StatementKind;
  period: Period;
  /** /api/statements sorgusu */
  query: string;
  formats: StatementFormat[];
}

const MONTHS = ['ocak', 'subat', 'mart', 'nisan', 'mayis', 'haziran', 'temmuz', 'agustos', 'eylul', 'ekim', 'kasim', 'aralik'];
const MONTH_RE = new RegExp(`(?:^| )(?:(\\d{1,2}) )?(${MONTHS.join('|')})[a-z]*(?: (\\d{4}))?`);
/** Rapor isteği olduğunu gösteren kelimeler (kelime başı) */
const REPORT_WORDS = /(?:^| )(rapor|ekstre|ozet|dokum|indir|pdf|excel|xlsx|word|docx|gun sonu|statement|report)/;
/** Tarih belirtmeden de anlamlı olanlar: varsayılan dönemle açılır */
const DEFAULTABLE = /(?:^| )(ekstre|gun sonu)/;

const pad = (n: number) => String(n).padStart(2, '0');
const iso = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`;

function validDay(y: number, m: number, d: number): boolean {
  if (m < 1 || m > 12 || d < 1) return false;
  return d <= new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/** Yıl verilmediyse: gelecekte kalıyorsa geçen yıl */
const inferYear = (month: number, day: number, today: string) => {
  const y = Number(today.slice(0, 4));
  return iso(y, month, day) > today ? y - 1 : y;
};

function mondayOf(date: string): string {
  const weekday = (new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7; // Pazartesi = 0
  return addDays(date, -weekday);
}

function detectFormats(text: string): StatementFormat[] {
  const formats: StatementFormat[] = [];
  if (/(?:^| )(excel|xlsx)/.test(text)) formats.push('excel');
  if (/(?:^| )pdf/.test(text)) formats.push('pdf');
  if (/(?:^| )(word|docx)/.test(text)) formats.push('word');
  return formats;
}

function toRequest(kind: StatementKind, period: Period, explicit: StatementFormat[]): StatementRequest {
  const query =
    kind === 'monthly' ? `kind=monthly&month=${period.from.slice(0, 7)}` : kind === 'daily' ? `kind=daily&date=${period.from}` : `kind=range&from=${period.from}&to=${period.to}`;
  // Varsayılan: ekstre Excel, günlük/dönem raporu PDF ve Word
  const formats: StatementFormat[] = explicit.length > 0 ? explicit : kind === 'monthly' ? ['excel', 'pdf'] : ['pdf', 'word'];
  return { kind, period, query, formats };
}

/** Soru bir rapor isteği değilse null. today: kullanıcının yerel günü (YYYY-AA-GG). */
export function parseStatementRequest(question: string, today: string): StatementRequest | null {
  const raw = question.toLocaleLowerCase('tr-TR');
  const text = normalizeText(question);
  if (!REPORT_WORDS.test(text)) return null;
  const formats = detectFormats(text);
  const y = Number(today.slice(0, 4));
  const m = Number(today.slice(5, 7));

  // Tarih aralığı: "01.09.2026 - 15.09.2026", "1/9 ile 15/9 arası"
  const dates = [...raw.matchAll(/(\d{1,2})[./](\d{1,2})(?:[./](\d{2,4}))?/g)]
    .map((match) => {
      const day = Number(match[1]);
      const month = Number(match[2]);
      const year = match[3] ? Number(match[3].length === 2 ? `20${match[3]}` : match[3]) : inferYear(month, day, today);
      return validDay(year, month, day) ? iso(year, month, day) : null;
    })
    .filter((d): d is string => d !== null);
  if (dates.length >= 2) {
    const [from, to] = [dates[0]!, dates[1]!].sort();
    return toRequest('range', { from: from!, to: to! }, formats);
  }
  if (dates.length === 1) return toRequest('daily', { from: dates[0]!, to: dates[0]! }, formats);

  // Göreli günler
  if (/(?:^| )bugun(?:un|ku)?(?: |$)/.test(text)) return toRequest('daily', { from: today, to: today }, formats);
  if (/(?:^| )(evvelsi gun|onceki gun)/.test(text)) {
    const day = addDays(today, -2);
    return toRequest('daily', { from: day, to: day }, formats);
  }
  if (/(?:^| )dun(?:un|ku)?(?: |$)/.test(text)) {
    const day = addDays(today, -1);
    return toRequest('daily', { from: day, to: day }, formats);
  }

  // "son 7 gün", "bu hafta", "geçen hafta", "bu yıl", "geçen yıl"
  const lastDays = text.match(/(?:^| )son (\d{1,3}) gun/);
  if (lastDays) {
    const n = Math.max(1, Math.min(366, Number(lastDays[1])));
    return toRequest(n === 1 ? 'daily' : 'range', { from: addDays(today, -(n - 1)), to: today }, formats);
  }
  if (/(?:^| )bu hafta/.test(text)) return toRequest('range', { from: mondayOf(today), to: today }, formats);
  if (/(?:^| )(gecen|onceki) hafta/.test(text)) {
    const monday = addDays(mondayOf(today), -7);
    return toRequest('range', { from: monday, to: addDays(monday, 6) }, formats);
  }
  if (/(?:^| )bu yil/.test(text)) return toRequest('range', { from: `${y}-01-01`, to: today }, formats);
  if (/(?:^| )(gecen|onceki) yil/.test(text)) return toRequest('range', { from: `${y - 1}-01-01`, to: `${y - 1}-12-31` }, formats);

  // Ay adı: "15 ekim" (gün) veya "eylül 2026" (ay)
  const named = text.match(MONTH_RE);
  if (named) {
    const month = MONTHS.indexOf(named[2]!) + 1;
    const day = named[1] ? Number(named[1]) : null;
    if (day !== null) {
      const year = named[3] ? Number(named[3]) : inferYear(month, day, today);
      if (validDay(year, month, day)) return toRequest('daily', { from: iso(year, month, day), to: iso(year, month, day) }, formats);
    }
    const year = named[3] ? Number(named[3]) : month > m ? y - 1 : y;
    return toRequest('monthly', monthPeriod(`${year}-${pad(month)}`), formats);
  }
  if (/(?:^| )(gecen|onceki) ay/.test(text)) {
    const prev = m === 1 ? `${y - 1}-12` : `${y}-${pad(m - 1)}`;
    return toRequest('monthly', monthPeriod(prev), formats);
  }
  if (/(?:^| )bu ay/.test(text)) return toRequest('monthly', monthPeriod(today.slice(0, 7)), formats);

  // Tarihsiz: "ekstre" → geçen ay, "gün sonu" → bugün
  if (DEFAULTABLE.test(text)) {
    if (/(?:^| )gun sonu/.test(text)) return toRequest('daily', { from: today, to: today }, formats);
    const prev = m === 1 ? `${y - 1}-12` : `${y}-${pad(m - 1)}`;
    return toRequest('monthly', monthPeriod(prev), formats);
  }
  return null;
}
