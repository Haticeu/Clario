/**
 * Analiz motorunun dış arayüzü: dört temel analiz fonksiyonu.
 *
 * Kullanılan eşikler aşağıda yeniden dışa aktarılır. Değerlerin tek kaynağı
 * config/thresholds.ts dosyasıdır; burada sabitlerin kopyası tutulmaz, çünkü aynı
 * eşikler dashboard, stok ve asistan modüllerinde de kullanılır.
 *
 * Her fonksiyon, analiz bağlamı (referans tarihi ve pencereler) verilmezse onu
 * veritabanındaki son sipariş tarihinden kendisi oluşturur.
 */
import { getAnalysisContext, type AnalysisContext } from './analysis/context.js';
import { detectChurnRisks } from './analysis/customers.js';
import { getMarginAnalysis } from './analysis/margins.js';
import { detectOpportunities as detectOpportunitiesInContext } from './analysis/opportunities.js';
import { detectRisks as detectRisksInContext } from './analysis/risks.js';
import type { DbClient } from './db/types.js';

export {
  RISK_DECLINE_THRESHOLD, // 0.15 → son 30 gün satışı en az %15 düştüyse risk
  HIGH_STOCK_MONTHS, // 4   → stok 4 aydan uzun yetiyorsa fazla stok
  LOW_STOCK_MONTHS, // 1.5 → stok 1,5 aydan kısa sürede bitecekse tükenme riski
  OPPORTUNITY_GROWTH_THRESHOLD, // 0.20 → ürün-bölge satışı son 3 haftada en az %20 arttıysa fırsat
  OPPORTUNITY_MIN_Z_SCORE, // 2   → artış olağan dalgalanmanın en az 2σ üzerinde olmalı
  CHURN_MULTIPLIER, // 2.5 → medyan sipariş aralığının 2,5 katı sessizlik = kayıp riski
  LOW_MARGIN_THRESHOLD, // 0.10 → %10'un altındaki marj düşük sayılır
} from './config/thresholds.js';

async function resolveContext(db: DbClient, ctx?: AnalysisContext) {
  return ctx ?? getAnalysisContext(db);
}

/** Satış düşüşü, fazla stok ve tükenme riski taşıyan ürünler (öneri metinleriyle). */
export async function detectRisks(db: DbClient, ctx?: AnalysisContext) {
  return detectRisksInContext(db, await resolveContext(db, ctx));
}

/** Son 3 haftada anlamlı biçimde büyüyen ürün-bölge kombinasyonları ve stok transfer önerileri. */
export async function detectOpportunities(db: DbClient, ctx?: AnalysisContext) {
  return detectOpportunitiesInContext(db, await resolveContext(db, ctx));
}

/** Kendi medyan sipariş aralığının CHURN_MULTIPLIER katından uzun süredir sessiz müşteriler. */
export async function detectCustomerChurn(db: DbClient, ctx?: AnalysisContext) {
  return detectChurnRisks(db, await resolveContext(db, ctx));
}

/** Gerçekleşen ortalama satış fiyatı ile maliyetin karşılaştırması; en düşük marj başta. */
export async function marginAnalysis(db: DbClient, ctx?: AnalysisContext) {
  return getMarginAnalysis(db, await resolveContext(db, ctx));
}
