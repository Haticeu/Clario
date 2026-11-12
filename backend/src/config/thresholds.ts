/**
 * Analiz motorunun tüm eşik değerleri.
 *
 * Analiz fonksiyonları hiçbir sonucu sabit olarak üretmez; yalnızca bu eşikleri
 * veritabanındaki gerçek veriye uygular. İleride bu değerler bir ayarlar ekranından
 * veya işletme bazlı konfigürasyondan okunabilir.
 */

/** Bir ayın gün karşılığı (satış hızı → aylık stok hesabında kullanılır). */
export const DAYS_PER_MONTH = 30;

// ── Karşılaştırma pencereleri ────────────────────────────────────────────────
/** Satış/risk analizi: son N gün, önceki N gün ile karşılaştırılır. */
export const COMPARISON_WINDOW_DAYS = 30;
/** Fırsat analizi: son N gün, önceki N gün ile karşılaştırılır (3 hafta). */
export const OPPORTUNITY_WINDOW_DAYS = 21;
/** Marj analizinde gerçekleşen fiyatın hesaplandığı dönem. */
export const MARGIN_WINDOW_DAYS = 90;
/** Haftalık ciro trendinde gösterilecek hafta sayısı. */
export const TREND_WEEKS = 26;
/** Bu oranın altındaki ciro değişimi "yatay" olarak yorumlanır (0.02 = ±%2). */
export const REVENUE_FLAT_THRESHOLD = 0.02;

// ── Risk tespiti ─────────────────────────────────────────────────────────────
/** Son dönem satışı önceki döneme göre en az bu oranda düşerse risk (0.15 = %15). */
export const RISK_DECLINE_THRESHOLD = 0.15;
/** Mevcut stok, satış hızına göre bu kadar aydan uzun yetecekse "fazla stok". */
export const HIGH_STOCK_MONTHS = 4;
/** Mevcut stok, satış hızına göre bu kadar aydan kısa sürede bitecekse "tükenme riski". */
export const LOW_STOCK_MONTHS = 1.5;
/** Sağlıklı kabul edilen hedef stok seviyesi (ay). Fazla/eksik miktar buna göre hesaplanır. */
export const TARGET_STOCK_MONTHS = 2;

// ── Fırsat tespiti ───────────────────────────────────────────────────────────
/** Ürün-bölge satışı önceki pencereye göre en az bu oranda artarsa fırsat (0.20 = %20). */
export const OPPORTUNITY_GROWTH_THRESHOLD = 0.2;
/** Gürültüyü elemek için: önceki pencerede en az bu kadar adet satılmış olmalı. */
export const OPPORTUNITY_MIN_BASE_UNITS = 30;
/**
 * Anlamlılık kontrolü: artış, ürün-bölgenin önceki N haftalık olağan dalgalanmasına göre
 * de anlamlı olmalı. Son pencerenin satışı, bu dönemin haftalık ortalamasından hesaplanan
 * beklenen değerin en az OPPORTUNITY_MIN_Z_SCORE standart sapma üzerinde olmalıdır.
 * Böylece az müşterili kombinasyonlardaki doğal sipariş dalgalanması fırsat sayılmaz.
 */
export const OPPORTUNITY_BASELINE_WEEKS = 12;
export const OPPORTUNITY_MIN_Z_SCORE = 2;
/** Stok aktarımında kaynak bölgede bırakılması gereken minimum stok (ay). */
export const DONOR_MIN_STOCK_MONTHS = 1.5;
/** Transfer önerileri bu katlara yuvarlanır (operasyonel olarak anlamlı miktar). */
export const TRANSFER_ROUNDING_UNITS = 10;

// ── Müşteri kaybı (churn) ────────────────────────────────────────────────────
/** Müşteri, kendi medyan sipariş aralığının bu katından uzun süredir sessizse "kayıp riski". */
export const CHURN_MULTIPLIER = 2.5;
/** Bu katın üzerindeki sessizlik "izlemede" olarak işaretlenir. */
export const CHURN_WATCH_MULTIPLIER = 1.5;
/** Tipik aralık hesaplanabilmesi için gereken minimum sipariş sayısı. */
export const CHURN_MIN_ORDERS = 4;

// ── Müşteri segmentasyonu (ABC / Pareto) ─────────────────────────────────────
/** Cironun ilk %80'ini oluşturan müşteriler A segmenti. */
export const SEGMENT_A_REVENUE_SHARE = 0.8;
/** Sonraki %15 (kümülatif %95'e kadar) B segmenti, kalanı C. */
export const SEGMENT_B_REVENUE_SHARE = 0.95;

// ── Marj analizi ─────────────────────────────────────────────────────────────
/** Bu oranın altındaki brüt marj "düşük marj" kabul edilir (0.10 = %10). */
export const LOW_MARGIN_THRESHOLD = 0.1;

// ── Önceliklendirme ──────────────────────────────────────────────────────────
/** Etkisi aylık cironun bu payını aşan aksiyonlar "yüksek" önceliklidir. */
export const PRIORITY_HIGH_IMPACT_SHARE = 0.03;
/** Etkisi aylık cironun bu payını aşan aksiyonlar "orta" önceliklidir. */
export const PRIORITY_MEDIUM_IMPACT_SHARE = 0.01;
/** Genel Bakış'ta gider ortalaması için kullanılan tamamlanmış ay sayısı. */
export const EXPENSE_AVERAGE_MONTHS = 3;
