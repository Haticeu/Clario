import type { AnalysisContext } from '../analysis/context.js';
import { getCustomerActivity, type CustomerActivity } from '../analysis/customers.js';
import { getCustomerLedger, getReceivableSettings } from '../analysis/receivables.js';
import { fxFactor } from '../currency/money.js';
import type { DbClient } from '../db/types.js';
import { formatCurrency, formatDate, formatNumber, formatPercent } from '../utils/format.js';
import { normalizeText, tokenize } from './text.js';

/**
 * Müşteri profili: "Kuzey Holding ne durumda?", "Batı Market'in son siparişi ne zaman?" gibi sorularda sorudaki
 * müşteri adı bulunur ve o müşterinin ciro, sipariş ritmi, kayıp riski ve ürün dağılımı anlatılır.
 */

/** Ad eşleşmesinde ayırt edici sayılmayan yaygın şirket kelimeleri */
const GENERIC = new Set([
  'market', 'marketi', 'holding', 'ltd', 'sti', 'as', 'a s', 'dagitim', 'toptan', 'ticaret', 'sanayi', 'magaza', 'magazasi',
  'zinciri', 'grup', 'group', 'insaat', 'gida', 'lojistik', 'tekstil', 'otomotiv', 've', 'ofis', 'tedarik', 'hijyen',
]);

export interface CustomerMatch {
  id: number;
  name: string;
}

/** Sorudaki müşteri adını bulur: ayırt edici kelimelerin hepsi (Türkçe eklerle) soruda geçmeli */
export function findCustomer(question: string, customers: CustomerMatch[]): CustomerMatch | null {
  const tokens = tokenize(normalizeText(question));
  const text = ` ${tokenize(normalizeText(question)).join(' ')} `;
  let best: { customer: CustomerMatch; score: number } | null = null;
  for (const customer of customers) {
    const normalized = normalizeText(customer.name);
    // Tam ad geçiyorsa en güçlü eşleşme
    if (text.includes(` ${normalized}`)) {
      const score = 100 + normalized.length;
      if (!best || score > best.score) best = { customer, score };
      continue;
    }
    const words = tokenize(normalized).filter((w) => w.length >= 4 && !GENERIC.has(w) && !/^\d+$/.test(w));
    if (words.length === 0) continue;
    if (words.every((w) => tokens.some((t) => t.startsWith(w)))) {
      const score = words.reduce((sum, w) => sum + w.length, 0);
      if (!best || score > best.score) best = { customer, score };
    }
  }
  return best?.customer ?? null;
}

const STATUS_TEXT: Record<CustomerActivity['status'], string> = {
  active: 'düzenli sipariş veriyor',
  watch: 'sipariş aralığı uzamaya başladı; takip edilmeli',
  churn_risk: 'kayıp riski taşıyor: tipik sipariş aralığının belirgin biçimde dışında',
  insufficient_data: 'sipariş ritmini ölçmek için yeterli geçmiş yok',
};

export async function customerProfile(db: DbClient, ctx: AnalysisContext, customer: CustomerMatch) {
  const fx = fxFactor('o.order_date');
  const window = (from: string, to: string) =>
    db.queryOne<{ revenue: number; orders: number }>(
      `SELECT COALESCE(SUM(oi.quantity * oi.unit_price * ${fx}), 0) AS revenue, COUNT(DISTINCT o.id) AS orders
       FROM orders o JOIN order_items oi ON oi.order_id = o.id
       WHERE o.customer_id = ? AND o.status = 'delivered' AND o.order_date >= ? AND o.order_date <= ?`,
      [customer.id, from, to],
    );
  const [activities, current, previous, products, cancelled, projects] = await Promise.all([
    getCustomerActivity(db, ctx),
    window(ctx.current.from, ctx.current.to),
    window(ctx.previous.from, ctx.previous.to),
    db.query<{ name: string; revenue: number }>(
      `SELECT p.name, SUM(oi.quantity * oi.unit_price * ${fx}) AS revenue
       FROM orders o JOIN order_items oi ON oi.order_id = o.id JOIN products p ON p.id = oi.product_id
       WHERE o.customer_id = ? AND o.status = 'delivered' GROUP BY p.id, p.name ORDER BY revenue DESC LIMIT 3`,
      [customer.id],
    ),
    db.queryOne<{ n: number }>(`SELECT COUNT(*) AS n FROM orders WHERE customer_id = ? AND status = 'cancelled'`, [customer.id]),
    db.query<{ project: string }>(
      `SELECT DISTINCT project FROM orders WHERE customer_id = ? AND project IS NOT NULL AND project <> '' LIMIT 5`,
      [customer.id],
    ),
  ]);
  const activity = activities.find((a) => a.customer.id === customer.id);
  const lines: string[] = [];
  if (!activity || activity.orderCount === 0) {
    lines.push(`${customer.name} için henüz teslim edilmiş sipariş yok.`);
    return { lines, data: { customerId: customer.id } };
  }
  const c = activity.customer;
  lines.push(
    `${c.name} (${c.type}, ${c.region.name}${c.salesRepName ? `, temsilci ${c.salesRepName}` : ''}) — ${activity.segment} segmenti müşteri.`,
  );
  lines.push(
    `• Toplam ciro ${formatCurrency(activity.totalRevenue)}, ${formatNumber(activity.orderCount)} sipariş; aylık ortalama ${formatCurrency(activity.avgMonthlyRevenue)}.`,
  );
  const cur = Number(current?.revenue ?? 0);
  const prev = Number(previous?.revenue ?? 0);
  const change = prev > 0 ? cur / prev - 1 : null;
  lines.push(
    `• Son 30 gün: ${formatCurrency(cur)} (${formatNumber(Number(current?.orders ?? 0))} sipariş)` +
      (change === null ? (prev === 0 && cur > 0 ? '; önceki 30 günde alım yoktu.' : '.') : `; önceki 30 güne göre ${formatPercent(change)} ${change >= 0 ? 'artış' : 'düşüş'}.`),
  );
  if (activity.lastOrderDate) {
    lines.push(
      `• Son sipariş ${formatDate(activity.lastOrderDate)} (${formatNumber(activity.daysSinceLastOrder ?? 0)} gün önce)` +
        (activity.medianIntervalDays ? `; tipik aralık ${formatNumber(activity.medianIntervalDays)} gün.` : '.'),
    );
  }
  lines.push(`• Durum: ${STATUS_TEXT[activity.status]}.`);
  if (products.length) lines.push(`• En çok aldığı ürünler: ${products.map((p) => `${p.name} (${formatCurrency(Number(p.revenue))})`).join(', ')}.`);
  if (projects.length) lines.push(`• Projeler: ${projects.map((p) => p.project).join(', ')}.`);
  if ((cancelled?.n ?? 0) > 0) lines.push(`• İptal edilen sipariş: ${formatNumber(cancelled!.n)}.`);
  // Cari hesap (takip başlatıldıysa): bakiye, vadesi geçen, limit
  if ((await getReceivableSettings(db)).startDate) {
    const ledger = await getCustomerLedger(db, customer.id);
    if (ledger) {
      const money = new Intl.NumberFormat('tr-TR', { style: 'currency', currency: ledger.currency, maximumFractionDigits: 0 });
      lines.push(
        `• Cari bakiye ${money.format(ledger.balance)}` +
          (ledger.overdue > 0 ? `; vadesi geçen ${money.format(ledger.overdue)}` : '; vadesi geçmiş borcu yok') +
          (ledger.customer.creditLimit ? ` · kredi limiti ${money.format(ledger.customer.creditLimit)}${ledger.balance > ledger.customer.creditLimit ? ' (aşıldı)' : ''}` : '') +
          '.',
      );
    }
  }
  if (activity.status === 'churn_risk' || activity.status === 'watch') {
    lines.push(`Öneri: ${c.salesRepName ?? 'Satış ekibi'} müşteriyle iletişime geçsin; son siparişlerdeki ürünler için teklif hazırlanabilir.`);
  } else if (change !== null && change <= -0.25) {
    lines.push('Öneri: Alımlar belirgin düştü; fiyat, rakip ve teslimat memnuniyetini müşteriyle görüşün.');
  }
  return { lines, data: { customerId: customer.id } };
}
