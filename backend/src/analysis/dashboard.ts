import { EXPENSE_AVERAGE_MONTHS } from '../config/thresholds.js';
import type { DbClient } from '../db/types.js';
import { getExpenses } from '../repositories/expenseRepository.js';
import { addMonths, lastDayOfMonth } from '../utils/dates.js';
import { pctChange, round, sum } from '../utils/stats.js';
import type { AnalysisContext } from './context.js';
import { getRecommendations } from './recommendations.js';
import { getSalesAnalytics } from './sales.js';

function kpi(current: number, previous: number) {
  const change = pctChange(current, previous);
  return { current, previous, changePct: change === null ? null : round(change, 4) };
}

/** Son N tamamlanmış ayın ortalama aylık gideri (kategori kırılımıyla). */
async function getAverageMonthlyExpenses(db: DbClient, asOf: string) {
  const from = addMonths(asOf, -EXPENSE_AVERAGE_MONTHS);
  const to = lastDayOfMonth(addMonths(asOf, -1));
  const rows = await getExpenses(db, from, to);

  const byCategory = new Map<string, number>();
  for (const row of rows) byCategory.set(row.category, (byCategory.get(row.category) ?? 0) + row.amount);

  const categories = [...byCategory.entries()]
    .map(([category, total]) => ({ category, amount: round(total / EXPENSE_AVERAGE_MONTHS) }))
    .sort((a, b) => b.amount - a.amount);

  return { months: EXPENSE_AVERAGE_MONTHS, period: { from, to }, average: sum(categories.map((c) => c.amount)), byCategory: categories };
}

export async function getDashboardSummary(db: DbClient, ctx: AnalysisContext) {
  const [sales, recommendations, expenses] = await Promise.all([
    getSalesAnalytics(db, ctx),
    getRecommendations(db, ctx),
    getAverageMonthlyExpenses(db, ctx.asOf),
  ]);

  const { current, previous } = sales.totals;
  const grossProfit =
    current.grossProfit === null
      ? { current: null, previous: previous.grossProfit, changePct: null }
      : kpi(current.grossProfit, previous.grossProfit ?? 0);

  return {
    asOf: ctx.asOf,
    windows: sales.windows,
    kpis: {
      revenue: kpi(current.revenue, previous.revenue),
      orders: kpi(current.orders, previous.orders),
      activeCustomers: kpi(current.customers, previous.customers),
      avgOrderValue: kpi(current.avgOrderValue, previous.avgOrderValue),
      grossProfit: { ...grossProfit, marginPct: current.grossMarginPct, costCoverage: current.costCoverage },
      monthlyExpenses: expenses,
      /** Son 30 günün brüt kârı − ortalama aylık gider; ürün maliyetleri bilinmiyorsa null */
      estimatedNetProfit: current.grossProfit === null ? null : round(current.grossProfit - expenses.average),
      openRisks: recommendations.counts.bySource.risk,
      opportunities: recommendations.counts.bySource.opportunity,
      churnRisks: recommendations.counts.bySource.churn,
      highPriorityActions: recommendations.counts.high,
    },
    salesSummary: sales.explanation.summary,
    revenueTrend: sales.weeklyTrend,
    topRecommendations: recommendations.items.slice(0, 5),
  };
}
