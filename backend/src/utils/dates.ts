const MS_PER_DAY = 86_400_000;

/** Yarı açık tarih aralığı: (from, to] — `from` hariç, `to` dahil. ISO 'YYYY-MM-DD'. */
export interface DateWindow {
  from: string;
  to: string;
}

export function toIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function parseIsoDate(value: string): Date {
  return new Date(`${value}T00:00:00Z`);
}

export function todayIso(): string {
  return toIsoDate(new Date());
}

export function addDays(value: string, days: number): string {
  return toIsoDate(new Date(parseIsoDate(value).getTime() + days * MS_PER_DAY));
}

/** `from` → `to` arasındaki gün farkı (to > from ise pozitif). */
export function daysBetween(from: string, to: string): number {
  return Math.round((parseIsoDate(to).getTime() - parseIsoDate(from).getTime()) / MS_PER_DAY);
}

export function isSunday(value: string): boolean {
  return parseIsoDate(value).getUTCDay() === 0;
}

/** 'YYYY-MM' */
export function monthKey(value: string): string {
  return value.slice(0, 7);
}

export function firstDayOfMonth(value: string): string {
  return `${monthKey(value)}-01`;
}

export function lastDayOfMonth(value: string): string {
  const date = parseIsoDate(firstDayOfMonth(value));
  return toIsoDate(new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)));
}

export function addMonths(value: string, months: number): string {
  const date = parseIsoDate(firstDayOfMonth(value));
  return toIsoDate(new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + months, 1)));
}
