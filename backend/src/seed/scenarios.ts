/**
 * Seed verisine bilerek enjekte edilen eğilimler.
 *
 * Bu değerler YALNIZCA veri üretiminde ve doğrulama script'inde (npm run verify)
 * kullanılır. Analiz motoru bu dosyayı hiç okumaz; eğilimleri veriden kendisi bulmalıdır.
 */
export const SCENARIOS = {
  /** 1) Son 30 günde talep düşüşü + ~5 aylık fazla stok → Risk Tespiti */
  salesDeclineWithOverstock: {
    sku: 'TMZ-004',
    demandMultiplier: 0.75,
    startsDaysAgo: 30,
    stockMonths: { min: 4.8, max: 5.5 },
  },
  /** 2) Bir bölgede son 3 haftada belirgin talep artışı → Fırsat Tespiti */
  regionalDemandSurge: {
    sku: 'HJY-001',
    regionName: 'Bursa',
    demandMultiplier: 1.3,
    startsDaysAgo: 21,
    regionStockMonths: 0.5,
  },
  /** 3) Düzenli sipariş verirken ~8 haftadır sessiz kalan bayiler → Müşteri Kaybı */
  silentDealers: {
    customerNames: ['Boğaziçi Hijyen Ltd.', 'Başkent Hijyen Dağıtım', 'Ege Temizlik Bayi'],
    silentDays: { min: 55, max: 60 },
  },
  /**
   * Ek: tükenme riski kuralının da görülebilmesi için bir ürünün stoğu düşük tutulur.
   * (İstenen 3 senaryonun dışında; "stok < 1,5 ay" dalını göstermek için.)
   */
  lowStock: {
    sku: 'KAG-002',
    stockMonths: { min: 0.9, max: 1.2 },
  },
} as const;
