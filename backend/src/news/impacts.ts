import { getAnalysisContext, NoDataError } from '../analysis/context.js';
import { getInventoryIntelligence } from '../analysis/inventory.js';
import { getMarginAnalysis } from '../analysis/margins.js';
import { normalizeText } from '../assistant/text.js';
import { fxFactor } from '../currency/money.js';
import type { DbClient } from '../db/types.js';
import { getSalesTotals } from '../repositories/salesRepository.js';
import { addDays } from '../utils/dates.js';
import { formatCurrency, formatPercent } from '../utils/format.js';
import type { Direction, ThemeId } from './themes.js';

/** Haberlerin işletmeyle ilişkilendirilmesi için verinin kısa özeti (tutarlar gösterim para biriminde). */
export interface BusinessSnapshot {
  hasData: boolean;
  revenue30: number;
  topCategories: string[];
  /** Son 30 gün cirosunda bayilerin payı (0–1) */
  dealerShare: number | null;
  excessStockValue: number;
  stockoutCount: number;
  lowMarginProducts: string[];
  /** Aylık ortalama giderler (gider türü veya açıklamasındaki kelimelere göre) */
  expenses: { logistics: number; energy: number; personnel: number };
  /** Haberde geçerse ilgili sayılacak adlar: bölgeler, kategoriler, ürünler */
  mentions: { label: string; kind: 'region' | 'category' | 'product'; key: string }[];
}

const EXPENSE_WORDS = {
  logistics: ['lojistik', 'nakliye', 'kargo', 'sevkiyat', 'tasima'],
  energy: ['enerji', 'elektrik', 'yakit', 'akaryakit', 'dogalgaz', 'benzin', 'motorin'],
  personnel: ['personel', 'maas', 'ucret', 'sgk', 'bordro', 'calisan'],
} as const;

const EMPTY: BusinessSnapshot = {
  hasData: false,
  revenue30: 0,
  topCategories: [],
  dealerShare: null,
  excessStockValue: 0,
  stockoutCount: 0,
  lowMarginProducts: [],
  expenses: { logistics: 0, energy: 0, personnel: 0 },
  mentions: [],
};

export async function buildSnapshot(db: DbClient): Promise<BusinessSnapshot> {
  const [regions, categories, products] = await Promise.all([
    db.query<{ name: string }>('SELECT name FROM regions'),
    db.query<{ name: string }>('SELECT DISTINCT category AS name FROM products'),
    db.query<{ name: string }>('SELECT name FROM products'),
  ]);
  // Kısa/genel adlar (ör. "Genel", "Merkez") her haberde geçebileceği için eşleştirmede kullanılmaz
  const usable = (name: string) => normalizeText(name).length >= 4 && !['genel', 'merkez', 'diger'].includes(normalizeText(name));
  const mentions: BusinessSnapshot['mentions'] = [
    ...regions.filter((r) => usable(r.name)).map((r) => ({ label: r.name, kind: 'region' as const, key: normalizeText(r.name) })),
    ...categories.filter((c) => usable(c.name)).map((c) => ({ label: c.name, kind: 'category' as const, key: normalizeText(c.name) })),
    ...products.filter((p) => usable(p.name)).map((p) => ({ label: p.name, kind: 'product' as const, key: normalizeText(p.name) })),
  ];

  let ctx;
  try {
    ctx = await getAnalysisContext(db);
  } catch (error) {
    if (error instanceof NoDataError) return { ...EMPTY, mentions };
    throw error;
  }
  const from90 = addDays(ctx.asOf, -90);
  const fx = fxFactor('o.order_date');
  const [totals, topCategories, types, inventory, margins, expenseRows] = await Promise.all([
    getSalesTotals(db, ctx.current),
    db.query<{ name: string }>(
      `SELECT p.category AS name FROM orders o JOIN order_items oi ON oi.order_id = o.id JOIN products p ON p.id = oi.product_id
       WHERE o.status = 'delivered' AND o.order_date > ? GROUP BY p.category ORDER BY SUM(oi.quantity * oi.unit_price * ${fx}) DESC LIMIT 3`,
      [from90],
    ),
    db.query<{ type: string; revenue: number }>(
      `SELECT c.customer_type AS type, SUM(oi.quantity * oi.unit_price * ${fx}) AS revenue
       FROM orders o JOIN order_items oi ON oi.order_id = o.id JOIN customers c ON c.id = o.customer_id
       WHERE o.status = 'delivered' AND o.order_date > ? AND o.order_date <= ? GROUP BY c.customer_type`,
      [ctx.current.from, ctx.current.to],
    ),
    getInventoryIntelligence(db, ctx),
    getMarginAnalysis(db, ctx),
    db.query<{ category: string; description: string | null; amount: number }>(
      `SELECT category, description, amount * ${fxFactor('expense_date')} AS amount FROM expenses WHERE expense_date > ?`,
      [from90],
    ),
  ]);

  const totalTyped = types.reduce((sum, t) => sum + t.revenue, 0);
  const dealer = types.find((t) => t.type === 'Bayi')?.revenue ?? 0;
  const expenses = { logistics: 0, energy: 0, personnel: 0 };
  for (const row of expenseRows) {
    const text = normalizeText(`${row.category} ${row.description ?? ''}`);
    for (const [kind, words] of Object.entries(EXPENSE_WORDS) as [keyof typeof expenses, readonly string[]][]) {
      if (words.some((word) => text.includes(word))) expenses[kind] += row.amount / 3;
    }
  }

  return {
    hasData: true,
    revenue30: totals.revenue,
    topCategories: topCategories.map((c) => c.name),
    dealerShare: totalTyped > 0 ? dealer / totalTyped : null,
    excessStockValue: inventory.summary.excessValue,
    stockoutCount: inventory.summary.statusCounts.stockoutRisk,
    lowMarginProducts: margins.filter((m) => m.status !== 'healthy').slice(0, 3).map((m) => m.product.name),
    expenses,
    mentions,
  };
}

export interface Impact {
  /** Olası etki (kısa) */
  effect: string;
  /** İşletmenin verisiyle ilişkilendirilmiş ayrıntılar */
  details: string[];
  /** Önerilen aksiyon */
  action: string;
}

const list = (names: string[]) => names.map((n) => `"${n}"`).join(', ');

/**
 * Tema + yön → işletmeye olası etkisi. Metinler olasılık diliyle yazılır ("…olabilir"); ayrıntılar kullanıcının
 * kendi verisinden gelir (fazla stok, bayi payı, düşük marjlı ürünler, lojistik/enerji/personel giderleri).
 */
const NEUTRAL: Partial<Record<ThemeId, Impact>> = {
  interest: { effect: 'Faiz politikasındaki gelişmeler finansman maliyetini ve talebi etkileyebilir.', details: [], action: 'Kararın yönünü takip edin; stok ve vade politikanızı buna göre ayarlayın.' },
  currency: { effect: 'Kur hareketleri ithal maliyetleri ve fiyatları etkileyebilir.', details: [], action: 'Döviz bazlı maliyeti olan ürünleri izleyin.' },
  inflation: { effect: 'Enflasyon gelişmeleri maliyetleri ve alım gücünü etkileyebilir.', details: [], action: 'Fiyat listesini ve maliyetleri güncel tutun.' },
  energy: { effect: 'Enerji piyasasındaki gelişmeler nakliye ve üretim maliyetlerini etkileyebilir.', details: [], action: 'Enerji ve akaryakıt fiyatlarını takip edin.' },
  commodities: { effect: 'Hammadde piyasasındaki gelişmeler tedarik maliyetlerini etkileyebilir.', details: [], action: 'Tedarikçi fiyatlarını takip edin.' },
  demand: { effect: 'Tüketici talebindeki değişim satışlarınıza yansıyabilir.', details: [], action: 'Satış trendini Raporlar sayfasından izleyin.' },
  supply: { effect: 'Tedarik zincirindeki gelişmeler teslim sürelerini ve maliyetleri etkileyebilir.', details: [], action: 'Kritik ürünlerin tedarik durumunu takip edin.' },
  wages: { effect: 'Ücret düzenlemeleri personel giderlerini ve alım gücünü etkileyebilir.', details: [], action: 'Personel bütçesini gözden geçirin.' },
  growth: { effect: 'Ekonomik büyüme ve istihdam verileri genel talebi etkileyebilir.', details: [], action: 'Genel talep eğilimini takip edin.' },
};

export function describeImpact(theme: ThemeId, direction: Direction, s: BusinessSnapshot): Impact {
  const details: string[] = [];
  const up = direction !== 'down';
  // Yön belli değilse (ör. "faiz kararı açıklanacak") tahmin yürütülmez; tarafsız bir değerlendirme verilir
  const neutral = NEUTRAL[theme];
  if (direction === null && neutral) return neutral;

  switch (theme) {
    case 'interest':
      if (up) {
        if (s.excessStockValue > 0) details.push(`Fazla stokta bağlı ${formatCurrency(s.excessStockValue)} sermayenin finansman maliyeti yükselir.`);
        if (s.dealerShare !== null && s.dealerShare > 0.3) details.push(`Cironuzun ${formatPercent(s.dealerShare)} kadarı bayilerden geliyor; stok tutma maliyeti artan bayiler siparişlerini azaltabilir.`);
        return { effect: 'Kredi ve finansman maliyetleri artabilir; vadeli alımlar ve stok yatırımları yavaşlayabilir.', details, action: 'Fazla stoğu eritmeye öncelik verin, vadeli satış koşullarını ve tahsilat sürelerini gözden geçirin.' };
      }
      if (s.stockoutCount > 0) details.push(`Tükenme riskindeki ${s.stockoutCount} ürününüz talep canlanırsa daha hızlı bitebilir.`);
      return { effect: 'Finansman kolaylaşabilir; talep ve yatırımlar canlanabilir.', details, action: 'Talep artışına hazırlık için stok ve satın alma planını gözden geçirin.' };

    case 'currency':
      if (up) {
        if (s.lowMarginProducts.length) details.push(`Marjı zaten düşük ürünleriniz önce etkilenir: ${list(s.lowMarginProducts)}.`);
        return { effect: 'İthal ürün ve hammadde maliyetleri artabilir; fiyat listelerinin güncellenmesi gerekebilir.', details, action: 'Döviz bazlı maliyeti olan ürünlerin fiyatlarını gözden geçirin; tedarikte sabit fiyatlı anlaşmaları değerlendirin.' };
      }
      return { effect: 'İthal maliyetler gerileyebilir; fiyat rekabetinde avantaj doğabilir.', details, action: 'Tedarikçilerle yeni fiyat görüşmesi için uygun bir dönem olabilir.' };

    case 'inflation':
      if (up) {
        if (s.lowMarginProducts.length) details.push(`Maliyet artışı düşük marjlı ürünlerinizi zarara itebilir: ${list(s.lowMarginProducts)}.`);
        details.push('Ciro tutar olarak artsa bile gerçek büyüme için satılan adetleri izleyin.');
        return { effect: 'Maliyetler ve fiyatlar yükselebilir; müşterilerin alım gücü zayıflayabilir.', details, action: 'Fiyat listesini ve ürün maliyetlerini güncel tutun; müşteri bazında adet trendini takip edin.' };
      }
      return { effect: 'Fiyat baskısı hafifleyebilir; alım gücü toparlanabilir.', details, action: 'Kampanya ve fiyat stratejisini talep toparlanmasına göre planlayın.' };

    case 'energy':
      if (up) {
        const monthly = s.expenses.logistics + s.expenses.energy;
        if (monthly > 0) details.push(`Aylık lojistik/enerji gideriniz ~${formatCurrency(monthly)}; %10'luk artış ayda ~${formatCurrency(monthly * 0.1)} ek maliyet demek.`);
        return { effect: 'Nakliye, üretim ve enerji maliyetleri artabilir.', details, action: 'Sevkiyatları birleştirin, nakliye anlaşmalarını ve enerji tüketimini gözden geçirin.' };
      }
      return { effect: 'Nakliye ve enerji maliyetleri gerileyebilir.', details, action: 'Maliyet düşüşünü fiyat rekabetinde veya marjda değerlendirin.' };

    case 'commodities':
      if (s.topCategories.length) details.push(`En çok ciro yaptığınız kategoriler: ${list(s.topCategories)}; bunların tedarik maliyetlerini kontrol edin.`);
      return up
        ? { effect: 'Hammadde ve tedarik maliyetleri artabilir.', details, action: 'Tedarikçilerle fiyat sabitleme veya erken alım seçeneklerini değerlendirin.' }
        : { effect: 'Hammadde maliyetleri gerileyebilir.', details, action: 'Alım zamanlamasını fiyat düşüşünden yararlanacak şekilde planlayın.' };

    case 'supply':
      if (s.stockoutCount > 0) details.push(`Tükenme riskindeki ${s.stockoutCount} ürününüz teslim gecikmelerinden ilk etkilenecekler.`);
      return { effect: 'Teslim süreleri uzayabilir, tedarikte aksama olabilir.', details, action: 'Kritik ürünler için siparişleri öne alın ve alternatif tedarikçileri belirleyin.' };

    case 'demand':
      if (s.revenue30 > 0) details.push(`Son 30 gün cironuz ${formatCurrency(s.revenue30)}.`);
      return up
        ? { effect: 'Tüketici harcamaları artıyor; satışlarınız olumlu etkilenebilir.', details, action: 'Çok satan ürünlerde stok yeterliliğini kontrol edin.' }
        : { effect: 'Tüketici harcamaları zayıflıyor; siparişler yavaşlayabilir.', details, action: 'Kayıp riski taşıyan müşterilere öncelik verin, kampanya ve ödeme kolaylıklarını değerlendirin.' };

    case 'wages':
      if (s.expenses.personnel > 0) details.push(`Aylık personel gideriniz ~${formatCurrency(s.expenses.personnel)}; %10 artış ayda ~${formatCurrency(s.expenses.personnel * 0.1)} ek maliyet.`);
      return { effect: 'Personel giderleri artabilir; kısa vadede tüketicinin alım gücü de artabilir.', details, action: 'Bütçeyi yeni ücretlere göre güncelleyin; artan maliyetin fiyatlara etkisini hesaplayın.' };

    case 'tax':
      return { effect: 'Vergi ve düzenleme değişikliği fiyatlara ve kârlılığa yansıyabilir.', details, action: 'Etkilenen ürünleri belirleyip fiyat ve fatura süreçlerini güncelleyin.' };

    case 'trade':
      if (s.topCategories.length) details.push(`Kategorileriniz: ${list(s.topCategories)}.`);
      return { effect: 'İthalat/ihracat koşulları ve gümrük maliyetleri değişebilir.', details, action: 'İthal girdisi olan ürünlerde maliyet ve teslim sürelerini kontrol edin.' };

    case 'disaster':
      return { effect: 'Bölgesel talep ve tedarik aksayabilir; belirsizlik siparişleri erteletebilir.', details, action: 'Etkilenen bölgelerdeki müşteri ve stok durumunu kontrol edin.' };

    case 'growth':
      return up
        ? { effect: 'Ekonomik aktivite güçleniyor; talep artabilir.', details, action: 'Büyüyen ürün ve bölgelerde stok ve satış hedeflerini gözden geçirin.' }
        : { effect: 'Ekonomik yavaşlama talebi zayıflatabilir.', details, action: 'Nakit akışını ve alacakları yakından izleyin; maliyetleri gözden geçirin.' };
  }
}

/** Haberde işletmeye ait bir ad (bölge, kategori, ürün) geçiyor mu? */
export function findMentions(text: string, snapshot: BusinessSnapshot) {
  const normalized = ` ${normalizeText(text)} `;
  return snapshot.mentions.filter((m) => normalized.includes(` ${m.key}`));
}
