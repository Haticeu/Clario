export type Severity = 'high' | 'medium' | 'low';
export type InsightKind = 'risk' | 'opportunity' | 'churn';

export interface ProductRef {
  id: number;
  sku: string;
  name: string;
  category: string;
}

export interface RegionRef {
  id: number;
  name: string;
}

/**
 * Risk, fırsat ve kayıp riskinin ortak biçimi: "durum → öneri → etki".
 * Frontend kartları ve öneri listesi bu alanlar üzerinden çalışır.
 */
export interface InsightBase {
  id: string;
  kind: InsightKind;
  severity: Severity;
  title: string;
  /** Veriye dayalı durum tespiti. */
  message: string;
  /** Somut aksiyon önerisi. */
  recommendation: string;
  /** Tahmini finansal etki (₺). Önceliklendirmede kullanılır. */
  impactAmount: number;
  impactLabel: string;
}

const SEVERITY_RANK: Record<Severity, number> = { high: 3, medium: 2, low: 1 };

export function compareInsights(a: InsightBase, b: InsightBase): number {
  return SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity] || b.impactAmount - a.impactAmount;
}
