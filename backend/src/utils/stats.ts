export function sum(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

export function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
}

/** Örneklem standart sapması (n − 1). */
export function standardDeviation(values: readonly number[]): number {
  if (values.length < 2) return 0;
  const mean = sum(values) / values.length;
  return Math.sqrt(sum(values.map((v) => (v - mean) ** 2)) / (values.length - 1));
}

/**
 * Oransal değişim (0.25 = %25 artış). Önceki değer 0 ise oran tanımsızdır → null.
 */
export function pctChange(current: number, previous: number): number | null {
  if (previous === 0) return current === 0 ? 0 : null;
  return (current - previous) / previous;
}

export function round(value: number, decimals = 0): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

export function roundDownTo(value: number, step: number): number {
  return Math.floor(value / step) * step;
}

export function roundUpTo(value: number, step: number): number {
  return Math.ceil(value / step) * step;
}

export function groupSum<T>(items: readonly T[], key: (item: T) => number, value: (item: T) => number) {
  const totals = new Map<number, number>();
  for (const item of items) {
    const k = key(item);
    totals.set(k, (totals.get(k) ?? 0) + value(item));
  }
  return totals;
}
