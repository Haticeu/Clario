import type { AnalysisContext } from '../analysis/context.js';
import { getReceivables } from '../analysis/receivables.js';
import { formatDate as formatDay } from '../utils/format.js';
import { detectChurnRisks, getCustomerAnalysis } from '../analysis/customers.js';
import { getDashboardSummary } from '../analysis/dashboard.js';
import { getInventoryIntelligence } from '../analysis/inventory.js';
import { detectOpportunities } from '../analysis/opportunities.js';
import { getRecommendations } from '../analysis/recommendations.js';
import { detectRisks } from '../analysis/risks.js';
import { getSalesAnalytics } from '../analysis/sales.js';
import { getSegmentAnalysis, type SegmentRow } from '../analysis/segments.js';
import type { InsightBase } from '../analysis/types.js';
import { COMPARISON_WINDOW_DAYS, LOW_MARGIN_THRESHOLD } from '../config/thresholds.js';
import type { DbClient } from '../db/types.js';
import type { NewsService } from '../news/service.js';
import { formatCurrency, formatNumber, formatPercent, formatSignedCurrency, formatSignedPercent } from '../utils/format.js';
import type { QuestionEntities } from './entities.js';
import type { IntentId } from './intents.js';
import { normalizeText } from './text.js';

export interface HandlerResult {
  /** Satır satır okunabilir cevap metni. */
  lines: string[];
  /** Frontend'in kart olarak gösterebileceği ilgili tespitler. */
  items: InsightBase[];
  /** Cevabın dayandığı ham veri (şeffaflık için). */
  data?: unknown;
  /** Güncel haberlere dayanan cevaplarda kaynak bağlantıları */
  sources?: { title: string; url: string }[];
}

/** Dış servisler; tanımlı değilse ilgili cevaplar kurulum yönergesiyle döner. */
export interface AssistantServices {
  news: NewsService | null;
}

export type IntentHandler = (
  db: DbClient,
  ctx: AnalysisContext,
  entities: QuestionEntities,
  question: string,
  services: AssistantServices,
) => Promise<HandlerResult>;

const PRIORITY_LABEL = { high: 'Yüksek', medium: 'Orta', low: 'Düşük' } as const;
const MAX_ITEMS = 5;

const regionFilter = (entities: QuestionEntities) => new Set(entities.regions.map((r) => r.id));
const productFilter = (entities: QuestionEntities) => new Set(entities.products.map((p) => p.id));

export function scopeNote(entities: QuestionEntities): string | null {
  const parts = [...entities.regions.map((r) => `${r.name} bölgesi`), ...entities.products.map((p) => p.name)];
  return parts.length ? `Filtre: ${parts.join(', ')}.` : null;
}

function insightLine(emoji: string, label: string, item: InsightBase): string {
  return `${emoji} ${label}: ${item.message}\n   Öneri: ${item.recommendation}`;
}

const DECLINE_WORDS = /\b(dus|azal|gerile|kotu)/;
const GROWTH_WORDS = /\b(art|yuksel|buyu|iyi)/;

const salesChange: IntentHandler = async (db, ctx, entities, question) => {
  const sales = await getSalesAnalytics(db, ctx);
  const { direction } = sales.explanation;
  const text = normalizeText(question);
  const lines: string[] = [];

  // Sorunun öncülü veriyle çelişiyorsa bunu açıkça söyle, ardından sorulan yöndeki kalemleri göster.
  const askedDecline = DECLINE_WORDS.test(text) && direction !== 'down';
  const askedGrowth = GROWTH_WORDS.test(text) && !DECLINE_WORDS.test(text) && direction === 'down';
  if (askedDecline || askedGrowth) {
    const actual = direction === 'up' ? 'arttı' : direction === 'down' ? 'düştü' : 'yatay seyretti';
    lines.push(`Veriye göre toplam ciro son ${COMPARISON_WINDOW_DAYS} günde ${askedDecline ? 'düşmedi' : 'artmadı'}; ${actual}.`);
    const sign = askedDecline ? -1 : 1;
    const movers = sales.products
      .filter((p) => Math.sign(p.revenueDelta) === sign)
      .sort((a, b) => Math.abs(b.revenueDelta) - Math.abs(a.revenueDelta))
      .slice(0, 3);
    if (movers.length) {
      lines.push(`Buna rağmen ${askedDecline ? 'düşüş' : 'artış'} yaşayan ürünler:`);
      lines.push(
        ...movers.map(
          (p) =>
            `• ${p.product.name}: ${formatNumber(p.previousUnits)} → ${formatNumber(p.currentUnits)} adet ` +
            `(${formatSignedCurrency(p.revenueDelta)})`,
        ),
      );
    }
    lines.push('Genel tablo:');
  }

  lines.push(sales.explanation.summary, ...sales.explanation.bullets.map((b) => `• ${b}`));

  for (const region of entities.regions) {
    const r = sales.regions.find((x) => x.region.id === region.id);
    if (r) {
      lines.push(
        `• ${region.name} bölgesi: ${formatCurrency(r.previousRevenue)} → ${formatCurrency(r.currentRevenue)} ` +
          `(${r.revenueChangePct === null ? 'yeni' : formatSignedPercent(r.revenueChangePct)}).`,
      );
    }
  }
  for (const product of entities.products) {
    const p = sales.products.find((x) => x.product.id === product.id);
    if (p) {
      lines.push(
        `• ${product.name}: ${formatNumber(p.previousUnits)} → ${formatNumber(p.currentUnits)} adet, ` +
          `ciro etkisi ${formatSignedCurrency(p.revenueDelta)}.`,
      );
    }
  }

  const risks = (await detectRisks(db, ctx)).filter((r) => r.signals.includes('sales_decline'));
  return { lines, items: risks.slice(0, MAX_ITEMS), data: { totals: sales.totals, explanation: sales.explanation } };
};

const topSellers: IntentHandler = async (db, ctx) => {
  const sales = await getSalesAnalytics(db, ctx);
  const top = [...sales.products].sort((a, b) => b.currentRevenue - a.currentRevenue).slice(0, MAX_ITEMS);
  const lines = [
    `Son ${COMPARISON_WINDOW_DAYS} günde ciroya göre en çok satan ürünler:`,
    ...top.map(
      (p, i) =>
        `${i + 1}. ${p.product.name} — ${formatCurrency(p.currentRevenue)}, ${formatNumber(p.currentUnits)} adet` +
        (p.revenueChangePct === null ? '' : ` (${formatSignedPercent(p.revenueChangePct)})`),
    ),
  ];
  return { lines, items: [], data: top };
};

const churn: IntentHandler = async (db, ctx, entities) => {
  const regions = regionFilter(entities);
  const [items, analysis] = await Promise.all([detectChurnRisks(db, ctx), getCustomerAnalysis(db, ctx)]);
  const filtered = items.filter((c) => regions.size === 0 || regions.has(c.customer.region.id));

  if (filtered.length === 0) {
    return {
      lines: [
        'Şu anda kayıp riski taşıyan müşteri tespit edilmedi.',
        `İzlemede olan müşteri sayısı: ${analysis.summary.watch}.`,
      ],
      items: [],
    };
  }

  const total = filtered.reduce((t, c) => t + c.impactAmount, 0);
  return {
    lines: [
      `${filtered.length} müşteri, kendi tipik sipariş aralığının 2,5 katından uzun süredir sipariş vermiyor. ` +
        `Risk altındaki aylık ciro: ${formatCurrency(total)}.`,
      ...filtered.slice(0, MAX_ITEMS).map((c) => insightLine('🟠', 'Kayıp riski', c)),
    ],
    items: filtered.slice(0, MAX_ITEMS),
  };
};

const risks: IntentHandler = async (db, ctx, entities) => {
  const products = productFilter(entities);
  const items = (await detectRisks(db, ctx)).filter((r) => products.size === 0 || products.has(r.product.id));
  if (items.length === 0) return { lines: ['Mevcut eşiklere göre riskli ürün tespit edilmedi.'], items: [] };
  return {
    lines: [
      `${items.length} ürün için risk tespit edildi:`,
      ...items.slice(0, MAX_ITEMS).map((r) => insightLine('🔴', 'Risk', r)),
      'Güncel piyasa gelişmelerinin bu risklere etkisini görmek için "Piyasa durumu risklerimi nasıl etkiler?" diye sorabilirsiniz.',
    ],
    items: items.slice(0, MAX_ITEMS),
  };
};

/**
 * Güncel gündem ve piyasa: ekonomi haberleri kurallarla temalara ayrılır (faiz, kur, enflasyon, enerji…) ve
 * işletmenin verisiyle ilişkilendirilir. Harici yapay zekâ kullanılmaz.
 */
const market: IntentHandler = async (db, _ctx, _entities, _question, services) => {
  if (!services.news) return { lines: ['Gündem servisi bu kurulumda kapalı.'], items: [] };
  const feed = await services.news.getFeed(db);
  const relevant = feed.items.filter((item) => item.relevance !== 'low').slice(0, 3);
  if (relevant.length === 0) {
    const reachable = feed.sources.some((s) => s.ok);
    return {
      lines: [
        reachable
          ? 'Şu an gündemde işletmenizi belirgin biçimde etkileyebilecek bir gelişme görünmüyor. Genel Bakış\'taki Gündem bölümünden tüm başlıklara bakabilirsiniz.'
          : 'Haber kaynaklarına ulaşılamadı; internet bağlantısını kontrol edin.',
      ],
      items: [],
    };
  }
  const lines = ['Gündemden işletmenizi etkileyebilecek gelişmeler:'];
  for (const item of relevant) {
    lines.push(
      `• ${item.themeLabel}: ${item.title} (${item.source})`,
      `   Olası etki: ${[item.effect, ...item.details].join(' ')}`,
      `   Öneri: ${item.action}`,
    );
  }
  lines.push('Bu yorumlar haber başlıklarından kurallarla çıkarılır; olasılık belirtir, kesin tahmin değildir.');
  return {
    lines,
    items: [],
    sources: relevant.filter((item) => item.url).map((item) => ({ title: `${item.source}: ${item.title}`, url: item.url! })),
    data: { updatedAt: feed.updatedAt },
  };
};

const opportunities: IntentHandler = async (db, ctx, entities) => {
  const regions = regionFilter(entities);
  const products = productFilter(entities);
  const items = (await detectOpportunities(db, ctx)).filter(
    (o) => (regions.size === 0 || regions.has(o.region.id)) && (products.size === 0 || products.has(o.product.id)),
  );
  if (items.length === 0) return { lines: ['Son 3 haftada anlamlı bir satış artışı (fırsat) tespit edilmedi.'], items: [] };
  return {
    lines: [`${items.length} fırsat tespit edildi:`, ...items.slice(0, MAX_ITEMS).map((o) => insightLine('🟢', 'Fırsat', o))],
    items: items.slice(0, MAX_ITEMS),
  };
};

const inventory: IntentHandler = async (db, ctx, entities) => {
  const intel = await getInventoryIntelligence(db, ctx);
  const products = productFilter(entities);
  const regions = regionFilter(entities);

  if (intel.products.length > 0 && intel.products.every((p) => p.totalStock === null)) {
    return {
      lines: ['Henüz stok bilgisi girilmemiş. Veri Yönetimi → Stok sekmesinden veya Excel şablonundaki "Stok" sayfasından ürün × bölge stoklarını girerseniz fazla stok ve tükenme riskini hesaplarım.'],
      items: [],
    };
  }
  const lines = [
    `Toplam stok: ${formatNumber(intel.summary.totalUnits)} adet (maliyet değeri ${formatCurrency(intel.summary.totalValue)}). ` +
      `${intel.summary.statusCounts.stockoutRisk} ürün tükenme riskinde, ${intel.summary.statusCounts.excess} ürün fazla stokta.`,
  ];

  if (products.size > 0) {
    for (const row of intel.products.filter((p) => products.has(p.product.id))) {
      if (row.totalStock === null) {
        lines.push(`• ${row.product.name}: stok bilgisi girilmemiş.`);
        continue;
      }
      const cells = row.cells
        .filter((c) => regions.size === 0 || regions.has(c.regionId))
        .map((c) => {
          const name = intel.regions.find((r) => r.id === c.regionId)?.name ?? '?';
          return `${name}: ${formatNumber(c.stock ?? 0)} adet` + (c.monthsOfStock === null ? '' : ` (~${formatNumber(c.monthsOfStock, 1)} ay)`);
        });
      lines.push(
        `• ${row.product.name}: toplam ${formatNumber(row.totalStock)} adet` +
          (row.monthsOfStock === null ? '' : `, ~${formatNumber(row.monthsOfStock, 1)} aylık`) +
          ` — ${cells.join(', ')}.`,
      );
    }
  }

  const alerts = intel.alerts.filter((a) => products.size === 0 || products.has(a.product.id));
  lines.push(...alerts.slice(0, MAX_ITEMS).map((a) => insightLine('🔴', 'Stok uyarısı', a)));

  const regional = intel.regionalAlerts.filter(
    (a) => (regions.size === 0 || regions.has(a.region.id)) && (products.size === 0 || products.has(a.product.id)),
  );
  lines.push(...regional.slice(0, 3).map((a) => `⚠️ Bölgesel: ${a.message}`));

  return { lines, items: alerts.slice(0, MAX_ITEMS), data: intel.summary };
};

const margin: IntentHandler = async (db, ctx, entities) => {
  const sales = await getSalesAnalytics(db, ctx);
  const products = productFilter(entities);
  const margins = sales.margins.filter((m) => products.size === 0 || products.has(m.product.id));
  const losing = margins.filter((m) => m.status === 'loss');
  const low = margins.filter((m) => m.status === 'low');

  const lines: string[] = [];
  if (losing.length) {
    lines.push(`${losing.length} ürün son 90 günde maliyetinin altında satıldı (zarar ettiriyor):`);
  } else if (low.length) {
    lines.push(`Zarar eden ürün yok; ancak ${low.length} ürünün marjı eşik değerin (%${LOW_MARGIN_THRESHOLD * 100}) altında:`);
  } else {
    lines.push('En düşük marjlı ürünler (son 90 gün):');
  }

  for (const m of margins.slice(0, 3)) {
    const marginText = `${m.marginPct < 0 ? '−' : ''}${formatPercent(m.marginPct, 1)}`;
    lines.push(
      `• ${m.product.name}: ort. satış fiyatı ${formatCurrency(m.avgSellingPrice)}, maliyet ${formatCurrency(m.unitCost)} → ` +
        `marj ${marginText}, brüt kâr ${formatSignedCurrency(m.grossProfit)} (ort. iskonto ${formatPercent(m.avgDiscountPct, 1)}).`,
    );
  }
  const worst = margins[0];
  if (worst && worst.status !== 'healthy') {
    lines.push(
      `Öneri: ${worst.product.name} için iskonto politikası gözden geçirilmeli; liste fiyatı ${formatCurrency(worst.listPrice)} ` +
        `iken ortalama ${formatPercent(worst.avgDiscountPct, 1)} iskonto maliyetin altına düşürüyor. Fiyat artışı veya tedarikçiyle maliyet pazarlığı değerlendirilmeli.`,
    );
  }
  return { lines, items: [], data: margins.slice(0, 5) };
};

const profit: IntentHandler = async (db, ctx) => {
  const d = await getDashboardSummary(db, ctx);
  const { grossProfit, monthlyExpenses, estimatedNetProfit, revenue } = d.kpis;
  const expenseLines = [
    `Ortalama aylık gider (son ${monthlyExpenses.months} tamamlanmış ay): ${formatCurrency(monthlyExpenses.average)}.`,
    ...monthlyExpenses.byCategory.map((c) => `• ${c.category}: ${formatCurrency(c.amount)}`),
  ];
  if (grossProfit.current === null || grossProfit.marginPct === null || estimatedNetProfit === null) {
    return {
      lines: [
        `Son ${COMPARISON_WINDOW_DAYS} gün: ciro ${formatCurrency(revenue.current)}.`,
        'Ürün maliyetleri girilmediği için brüt ve net kâr hesaplanamıyor. Veri Yönetimi → Ürünler sekmesinden birim maliyetleri girin.',
        ...expenseLines,
      ],
      items: [],
      data: { grossProfit, monthlyExpenses, estimatedNetProfit },
    };
  }
  const coverageNote =
    grossProfit.costCoverage < 0.99
      ? ` Not: yalnızca maliyeti bilinen ürünler hesaba katıldı (cironun ${formatPercent(grossProfit.costCoverage)} kadarı).`
      : '';
  const lines = [
    `Son ${COMPARISON_WINDOW_DAYS} gün: ciro ${formatCurrency(revenue.current)}, brüt kâr ${formatCurrency(grossProfit.current)} ` +
      `(brüt marj ${formatPercent(grossProfit.marginPct, 1)}).${coverageNote}`,
    ...expenseLines,
    `Tahmini net kâr: ${formatSignedCurrency(estimatedNetProfit)} ` +
      `(ciroya oranı: ${revenue.current > 0 ? formatSignedPercent(estimatedNetProfit / revenue.current, 1) : '%0'}).`,
  ];
  return { lines, items: [], data: { grossProfit, monthlyExpenses, estimatedNetProfit } };
};

const recommendations: IntentHandler = async (db, ctx, entities) => {
  const recs = await getRecommendations(db, ctx);
  const regions = new Set(entities.regions.map((r) => r.name));
  const items = recs.items.filter((r) => regions.size === 0 || (r.regionName && regions.has(r.regionName)));
  return {
    lines: [
      `${items.length} aksiyon önerisi var (${recs.counts.high} yüksek öncelikli). Etkiye göre sıralı ilk ${Math.min(MAX_ITEMS, items.length)}:`,
      ...items
        .slice(0, MAX_ITEMS)
        .map((r, i) => `${i + 1}. [${PRIORITY_LABEL[r.priority]}] ${r.title}\n   → ${r.action} (${r.impactLabel}: ${formatCurrency(r.impactAmount)})`),
    ],
    items: [],
    data: items.slice(0, MAX_ITEMS),
  };
};

const summary: IntentHandler = async (db, ctx) => {
  const d = await getDashboardSummary(db, ctx);
  const { revenue, orders, activeCustomers, openRisks, opportunities: opps, churnRisks } = d.kpis;
  const change = (v: number | null) => (v === null ? '' : ` (${formatSignedPercent(v)})`);
  return {
    lines: [
      `Son ${COMPARISON_WINDOW_DAYS} günün özeti (${ctx.asOf} itibarıyla):`,
      `• Ciro: ${formatCurrency(revenue.current)}${change(revenue.changePct)}`,
      `• Sipariş: ${formatNumber(orders.current)}${change(orders.changePct)}`,
      `• Aktif müşteri: ${activeCustomers.current}${change(activeCustomers.changePct)}`,
      `• Açık risk: ${openRisks}, fırsat: ${opps}, kayıp riski taşıyan müşteri: ${churnRisks}`,
      d.salesSummary,
      ...(d.topRecommendations[0] ? [`En öncelikli aksiyon: ${d.topRecommendations[0].title} → ${d.topRecommendations[0].action}`] : []),
    ],
    items: [],
    data: d.kpis,
  };
};

const UNASSIGNED = 'Atanmamış';

function segmentLine(row: SegmentRow): string {
  const { current, allTime } = row;
  return (
    `• ${row.name ?? UNASSIGNED}: son 30 gün ciro ${formatCurrency(current.revenue)}, gider ${formatCurrency(current.expenses)}, ` +
    `net ${formatSignedCurrency(current.net)} · toplamda net ${formatSignedCurrency(allTime.net)}`
  );
}

/** Departman/proje kırılımı. Soruda "proje" geçiyorsa projeler, "departman" geçiyorsa departmanlar öne alınır. */
const segments: IntentHandler = async (db, ctx, _entities, question) => {
  const analysis = await getSegmentAnalysis(db, ctx);
  const text = normalizeText(question);
  const wanted = /proje/.test(text) && !/departman/.test(text) ? ['projects'] : /departman/.test(text) && !/proje/.test(text) ? ['departments'] : ['departments', 'projects'];
  const lines: string[] = [];

  for (const key of wanted as ('departments' | 'projects')[]) {
    const rows = analysis[key];
    const title = key === 'departments' ? 'Departmanlar' : 'Projeler';
    if (!rows.some((r) => r.name !== null)) {
      lines.push(`${title}: henüz ${key === 'departments' ? 'departman' : 'proje'} bilgisi girilmemiş. Satış ve gider kayıtlarına ekleyebilir veya Excel'de "${key === 'departments' ? 'Departman' : 'Proje'}" sütunuyla yükleyebilirsiniz.`);
      continue;
    }
    lines.push(`${title} (net katkı = ciro − ürün maliyeti − giderler):`, ...rows.slice(0, MAX_ITEMS + 1).map(segmentLine));
  }
  const alerts = analysis.alerts.filter((a) => wanted.includes(a.dimension === 'department' ? 'departments' : 'projects'));
  if (alerts.length > 0) lines.push('Dikkat:', ...alerts.slice(0, MAX_ITEMS).map((a) => `🔴 ${a.message}`));
  return { lines, items: [], data: analysis };
};

/** Cari hesap: alacaklar, vadesi geçenler, borçlar ve önümüzdeki 30 günün nakit görünümü */
const receivables: IntentHandler = async (db) => {
  const report = await getReceivables(db);
  if (report.setupRequired) {
    return {
      lines: [
        'Cari hesap takibi henüz başlatılmadı. Cari & Alacak sayfasından takip başlangıç tarihini seçin; ' +
          'tahsilatları elle, Excel ("Tahsilatlar" sayfası) veya ERP dışa aktarımıyla girebilirsiniz. ' +
          'e-Fatura yüklediyseniz vade ve fatura toplamları zaten hazır.',
      ],
      items: [],
    };
  }
  const money = new Intl.NumberFormat('tr-TR', { style: 'currency', currency: report.currency, maximumFractionDigits: 0 });
  const s = report.summary;
  const lines = [
    `Toplam alacak ${money.format(s.totalReceivable)}; vadesi geçen ${money.format(s.overdue)} (${s.overdueCustomers} müşteri)` +
      (s.dso !== null ? `. Ortalama tahsil süresi ~${s.dso} gün.` : '.'),
  ];
  const aging = s.aging;
  if (s.overdue > 0) {
    lines.push(`Yaşlandırma: 1–30 gün ${money.format(aging.d1_30)} · 31–60 gün ${money.format(aging.d31_60)} · 61–90 gün ${money.format(aging.d61_90)} · 90+ gün ${money.format(aging.d90plus)}.`);
    for (const c of report.customers.filter((x) => x.overdue > 0).slice(0, 5)) {
      lines.push(`• ${c.name}: ${money.format(c.overdue)} vadesi geçmiş (en eski ${c.oldestOverdueDays} gün)${c.overLimit ? ' · kredi limiti aşıldı' : ''}${c.lastPaymentDate ? ` · son tahsilat ${formatDay(c.lastPaymentDate)}` : ''}`);
    }
  }
  if (s.dueNext7 > 0) lines.push(`Bu hafta vadesi gelecek alacak: ${money.format(s.dueNext7)}.`);
  if (s.totalPayable > 0) {
    lines.push(`Tedarikçi borçları ${money.format(s.totalPayable)}; bu hafta ödenecek ${money.format(s.payableNext7)}${s.overduePayable > 0 ? `, vadesi geçmiş ${money.format(s.overduePayable)}` : ''}.`);
  }
  const net = report.outlook.reduce((sum, w) => sum + w.collections - w.payments, 0);
  lines.push(`Önümüzdeki 30 gün (vadelere göre): beklenen tahsilat ${money.format(s.dueNext30 + s.overdue)}, ödenecek ${money.format(s.payableNext30 + s.overduePayable)} → net ${money.format(net)}.`);
  if (aging.d61_90 + aging.d90plus > 0) lines.push('Öneri: 60 günü aşan alacaklar için müşteriyle ödeme planı yapın; gerekirse yeni sevkiyatı tahsilata bağlayın.');
  else if (s.overdue > 0) lines.push('Öneri: Vadesi geçen müşterileri bu hafta arayın; gecikme 30 günü geçmeden tahsilat tarihi alın.');
  if (s.overLimitCustomers > 0) lines.push(`${s.overLimitCustomers} müşteri kredi limitini aştı: yeni siparişleri onaya bağlayın.`);
  return { lines, items: [], data: { summary: s } };
};

export const HANDLERS: Record<IntentId, IntentHandler> = {
  sales_change: salesChange,
  top_sellers: topSellers,
  churn,
  risks,
  opportunities,
  inventory,
  margin,
  profit,
  recommendations,
  summary,
  market,
  segments,
  receivables,
};
