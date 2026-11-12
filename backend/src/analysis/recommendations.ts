import { PRIORITY_HIGH_IMPACT_SHARE, PRIORITY_MEDIUM_IMPACT_SHARE } from '../config/thresholds.js';
import type { DbClient } from '../db/types.js';
import { getSalesTotals } from '../repositories/salesRepository.js';
import { round } from '../utils/stats.js';
import type { AnalysisContext } from './context.js';
import { detectChurnRisks, type ChurnItem } from './customers.js';
import { detectOpportunities, type OpportunityItem } from './opportunities.js';
import { detectRisks, type RiskItem } from './risks.js';
import type { InsightKind, Severity } from './types.js';

export type Priority = 'high' | 'medium' | 'low';

export interface Recommendation {
  id: string;
  source: InsightKind;
  priority: Priority;
  /** Sıralama puanı: finansal etki × önem ağırlığı */
  priorityScore: number;
  title: string;
  situation: string;
  action: string;
  impactAmount: number;
  impactLabel: string;
  /** Aylık ciroya oranla etki büyüklüğü */
  impactShare: number;
  entity: { type: 'product' | 'customer'; id: number; name: string };
  regionName: string | null;
}

const SEVERITY_WEIGHT: Record<Severity, number> = { high: 1.5, medium: 1, low: 0.7 };

/**
 * Önceliklendirme: etki, işletmenin aylık cirosuna oranlanır (ölçekten bağımsız).
 * Ciddi (high) bir sinyal, etkisi küçük olsa bile en az "orta" öncelik alır.
 */
export function prioritize(impactAmount: number, severity: Severity, monthlyRevenue: number) {
  const share = monthlyRevenue > 0 ? impactAmount / monthlyRevenue : 0;
  let priority: Priority =
    share >= PRIORITY_HIGH_IMPACT_SHARE ? 'high' : share >= PRIORITY_MEDIUM_IMPACT_SHARE ? 'medium' : 'low';
  if (severity === 'high' && priority === 'low') priority = 'medium';
  return { priority, share, score: impactAmount * SEVERITY_WEIGHT[severity] };
}

function toRecommendation(item: RiskItem | OpportunityItem | ChurnItem, monthlyRevenue: number): Recommendation {
  const { priority, share, score } = prioritize(item.impactAmount, item.severity, monthlyRevenue);
  const base = {
    id: item.id,
    source: item.kind,
    priority,
    priorityScore: round(score),
    title: item.title,
    situation: item.message,
    action: item.recommendation,
    impactAmount: item.impactAmount,
    impactLabel: item.impactLabel,
    impactShare: round(share, 4),
  };

  switch (item.kind) {
    case 'risk':
      return { ...base, entity: { type: 'product', id: item.product.id, name: item.product.name }, regionName: null };
    case 'opportunity':
      return {
        ...base,
        entity: { type: 'product', id: item.product.id, name: item.product.name },
        regionName: item.region.name,
      };
    case 'churn':
      return {
        ...base,
        entity: { type: 'customer', id: item.customer.id, name: item.customer.name },
        regionName: item.customer.region.name,
      };
  }
}

export async function getRecommendations(db: DbClient, ctx: AnalysisContext) {
  const [risks, opportunities, churnRisks, totals] = await Promise.all([
    detectRisks(db, ctx),
    detectOpportunities(db, ctx),
    detectChurnRisks(db, ctx),
    getSalesTotals(db, ctx.current),
  ]);

  const items = [...risks, ...opportunities, ...churnRisks]
    .map((item) => toRecommendation(item, totals.revenue))
    .sort((a, b) => b.priorityScore - a.priorityScore);

  return {
    asOf: ctx.asOf,
    monthlyRevenue: round(totals.revenue),
    counts: {
      total: items.length,
      high: items.filter((i) => i.priority === 'high').length,
      medium: items.filter((i) => i.priority === 'medium').length,
      low: items.filter((i) => i.priority === 'low').length,
      bySource: { risk: risks.length, opportunity: opportunities.length, churn: churnRisks.length },
    },
    items,
  };
}
