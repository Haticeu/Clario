import { COMPARISON_WINDOW_DAYS, OPPORTUNITY_WINDOW_DAYS } from '../config/thresholds.js';
import type { DbClient } from '../db/types.js';
import { getLatestOrderDate } from '../repositories/salesRepository.js';
import { addDays, type DateWindow } from '../utils/dates.js';

export class NoDataError extends Error {
  constructor() {
    super('Henüz satış verisi yok. Veri Yönetimi sayfasından Excel ile yükleyin veya satış kaydı ekleyin.');
    this.name = 'NoDataError';
  }
}

/**
 * Tüm analizlerin ortak referans tarihi ve karşılaştırma pencereleri.
 * "Bugün" = verideki son sipariş tarihi; böylece analizler veri seti ne zaman
 * üretilmiş olursa olsun tutarlı çalışır.
 */
export interface AnalysisContext {
  asOf: string;
  /** Son 30 gün */
  current: DateWindow;
  /** Önceki 30 gün */
  previous: DateWindow;
  /** Son 3 hafta */
  opportunityCurrent: DateWindow;
  /** Önceki 3 hafta */
  opportunityPrevious: DateWindow;
}

function trailingWindow(asOf: string, days: number, offsetWindows = 0): DateWindow {
  const to = addDays(asOf, -days * offsetWindows);
  return { from: addDays(to, -days), to };
}

export function buildAnalysisContext(asOf: string): AnalysisContext {
  return {
    asOf,
    current: trailingWindow(asOf, COMPARISON_WINDOW_DAYS),
    previous: trailingWindow(asOf, COMPARISON_WINDOW_DAYS, 1),
    opportunityCurrent: trailingWindow(asOf, OPPORTUNITY_WINDOW_DAYS),
    opportunityPrevious: trailingWindow(asOf, OPPORTUNITY_WINDOW_DAYS, 1),
  };
}

export async function getAnalysisContext(db: DbClient): Promise<AnalysisContext> {
  const asOf = await getLatestOrderDate(db);
  if (!asOf) throw new NoDataError();
  return buildAnalysisContext(asOf);
}
