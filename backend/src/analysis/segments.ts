import type { DbClient } from '../db/types.js';
import {
  getExpensesBySegment,
  getSalesBySegment,
  type SegmentDimension,
  type SegmentExpenseRow,
  type SegmentSalesRow,
} from '../repositories/segmentRepository.js';
import { formatCurrency } from '../utils/format.js';
import { pctChange, round } from '../utils/stats.js';
import type { AnalysisContext } from './context.js';

/** Tüm zamanlar: ilk kayıttan veri tarihine kadar */
const ALL_TIME_FROM = '0000-01-01';

export interface SegmentFigures {
  revenue: number;
  /** Maliyeti bilinen ürünlerin maliyeti */
  productCost: number;
  expenses: number;
  /** Net katkı = ciro − ürün maliyeti − giderler */
  net: number;
  /** Ciro içinde maliyeti bilinen ürünlerin payı (0–1); 1'den küçükse net katkı olduğundan yüksek görünür */
  costCoverage: number;
  orders: number;
}

export interface SegmentRow {
  /** null: departman/proje girilmemiş kayıtlar ("Atanmamış") */
  name: string | null;
  /** Son 30 gün */
  current: SegmentFigures;
  previousRevenue: number;
  revenueChangePct: number | null;
  /** İlk kayıttan bugüne (projelerin toplam kârlılığı için) */
  allTime: SegmentFigures;
}

export interface SegmentAlert {
  dimension: SegmentDimension;
  name: string;
  severity: 'high' | 'medium';
  message: string;
}

const LABEL: Record<SegmentDimension, string> = { department: 'departmanı', project: 'projesi' };

function figures(sales: SegmentSalesRow | undefined, expenses: SegmentExpenseRow | undefined): SegmentFigures {
  const revenue = sales?.revenue ?? 0;
  const productCost = sales?.productCost ?? 0;
  const amount = expenses?.amount ?? 0;
  return {
    revenue: round(revenue),
    productCost: round(productCost),
    expenses: round(amount),
    net: round(revenue - productCost - amount),
    costCoverage: revenue > 0 ? round((sales?.costedRevenue ?? 0) / revenue, 4) : 0,
    orders: sales?.orders ?? 0,
  };
}

const byName = <T extends { name: string | null }>(rows: T[]) => new Map(rows.map((row) => [row.name, row]));

async function analyzeDimension(db: DbClient, ctx: AnalysisContext, dimension: SegmentDimension): Promise<SegmentRow[]> {
  const allTime = { from: ALL_TIME_FROM, to: ctx.asOf };
  const [current, previous, total, currentExpenses, totalExpenses] = await Promise.all([
    getSalesBySegment(db, dimension, ctx.current),
    getSalesBySegment(db, dimension, ctx.previous),
    getSalesBySegment(db, dimension, allTime),
    getExpensesBySegment(db, dimension, ctx.current),
    getExpensesBySegment(db, dimension, allTime),
  ]);
  const maps = {
    current: byName(current),
    previous: byName(previous),
    total: byName(total),
    currentExpenses: byName(currentExpenses),
    totalExpenses: byName(totalExpenses),
  };
  const names = new Set([...maps.total.keys(), ...maps.totalExpenses.keys()]);

  return [...names]
    .map((name) => {
      const previousRevenue = round(maps.previous.get(name)?.revenue ?? 0);
      const row = figures(maps.current.get(name), maps.currentExpenses.get(name));
      const change = pctChange(row.revenue, previousRevenue);
      return {
        name,
        current: row,
        previousRevenue,
        revenueChangePct: change === null ? null : round(change, 4),
        allTime: figures(maps.total.get(name), maps.totalExpenses.get(name)),
      };
    })
    .sort((a, b) => (a.name === null ? 1 : b.name === null ? -1 : b.allTime.revenue - a.allTime.revenue || b.allTime.expenses - a.allTime.expenses));
}

/** Zarar eden (son 30 günde veya toplamda net katkısı eksi) departman ve projeler. */
function findAlerts(dimension: SegmentDimension, rows: SegmentRow[]): SegmentAlert[] {
  const alerts: SegmentAlert[] = [];
  for (const row of rows) {
    if (row.name === null) continue;
    const { current, allTime } = row;
    if (current.net < 0 && (current.revenue > 0 || current.expenses > 0)) {
      alerts.push({
        dimension,
        name: row.name,
        severity: allTime.net < 0 ? 'high' : 'medium',
        message:
          `${row.name} ${LABEL[dimension]} son 30 günde ${formatCurrency(-current.net)} zarar etti ` +
          `(ciro ${formatCurrency(current.revenue)}` +
          (current.productCost > 0 ? `, ürün maliyeti ${formatCurrency(current.productCost)}` : '') +
          `, gider ${formatCurrency(current.expenses)}).` +
          (allTime.net < 0 ? ` Başından beri toplam zarar: ${formatCurrency(-allTime.net)}.` : ''),
      });
    } else if (allTime.net < 0) {
      alerts.push({
        dimension,
        name: row.name,
        severity: 'medium',
        message: `${row.name} ${LABEL[dimension]} başından beri toplamda ${formatCurrency(-allTime.net)} zararda (son 30 gün kârlı).`,
      });
    }
  }
  return alerts;
}

/**
 * Departman ve proje analizi: her birinin cirosu, ürün maliyeti, giderleri ve net katkısı
 * (son 30 gün ve tüm zamanlar). Departman/proje girilmemiş kayıtlar "Atanmamış" (null) satırında toplanır.
 */
export async function getSegmentAnalysis(db: DbClient, ctx: AnalysisContext) {
  const [departments, projects] = await Promise.all([
    analyzeDimension(db, ctx, 'department'),
    analyzeDimension(db, ctx, 'project'),
  ]);
  const tagged = (rows: SegmentRow[]) => rows.filter((r) => r.name !== null).length;
  const share = (rows: SegmentRow[], pick: (f: SegmentFigures) => number) => {
    const total = rows.reduce((sum, r) => sum + pick(r.allTime), 0);
    const assigned = rows.filter((r) => r.name !== null).reduce((sum, r) => sum + pick(r.allTime), 0);
    return total > 0 ? round(assigned / total, 4) : 0;
  };

  return {
    asOf: ctx.asOf,
    windows: { current: ctx.current, previous: ctx.previous },
    departments,
    projects,
    alerts: [...findAlerts('department', departments), ...findAlerts('project', projects)].sort((a, b) =>
      a.severity === b.severity ? 0 : a.severity === 'high' ? -1 : 1,
    ),
    /** Kayıtların ne kadarına departman/proje girildiği (ciro ve gider payı olarak) */
    coverage: {
      departments: { count: tagged(departments), revenueShare: share(departments, (f) => f.revenue), expenseShare: share(departments, (f) => f.expenses) },
      projects: { count: tagged(projects), revenueShare: share(projects, (f) => f.revenue), expenseShare: share(projects, (f) => f.expenses) },
    },
  };
}

export type SegmentAnalysis = Awaited<ReturnType<typeof getSegmentAnalysis>>;
