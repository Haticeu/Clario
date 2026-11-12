/**
 * Enjekte edilen senaryoların analiz motoru tarafından veriden bulunup bulunmadığını
 * doğrular ve tüm tespitleri terminale yazdırır.
 *
 *   npm run verify
 *
 * Not: SCENARIOS yalnızca burada, "beklenen sonuç" olarak okunur; analiz fonksiyonları
 * bu dosyadan habersizdir.
 */
import { getAnalysisContext } from '../analysis/context.js';
import { getRecommendations } from '../analysis/recommendations.js';
import { getSalesAnalytics } from '../analysis/sales.js';
import { detectCustomerChurn, detectOpportunities, detectRisks, marginAnalysis } from '../analytics.js';
import { env } from '../config/env.js';
import { openDatabase } from '../db/index.js';
import { SCENARIOS } from '../seed/scenarios.js';
import { formatCurrency, formatNumber, formatPercent } from '../utils/format.js';

const PRIORITY_LABEL = { high: 'Yüksek', medium: 'Orta', low: 'Düşük' } as const;

function heading(text: string) {
  console.log(`\n${'─'.repeat(80)}\n${text}\n${'─'.repeat(80)}`);
}

// Doğrulama, enjekte edilen senaryoları içeren test veritabanında çalışır (önce: npm run seed).
const db = await openDatabase(env.testDatabasePath);
try {
  const ctx = await getAnalysisContext(db);
  const [risks, opportunities, churn, margins, sales, recommendations] = await Promise.all([
    detectRisks(db, ctx),
    detectOpportunities(db, ctx),
    detectCustomerChurn(db, ctx),
    marginAnalysis(db, ctx),
    getSalesAnalytics(db, ctx),
    getRecommendations(db, ctx),
  ]);

  console.log(`Referans tarihi (son sipariş günü): ${ctx.asOf}`);
  console.log(`Son 30 gün: (${ctx.current.from}, ${ctx.current.to}]  |  Önceki 30 gün: (${ctx.previous.from}, ${ctx.previous.to}]`);

  heading(`RİSK TESPİTİ — ${risks.length} ürün`);
  for (const r of risks) {
    console.log(`🔴 Risk [${r.signals.join(', ')}]: ${r.message}\n   Öneri: ${r.recommendation}\n`);
  }

  heading(`FIRSAT TESPİTİ — ${opportunities.length} ürün-bölge`);
  for (const o of opportunities) {
    const z = o.metrics.zScore === null ? '∞' : o.metrics.zScore.toFixed(1);
    console.log(`🟢 Fırsat: ${o.message} [z=${z}]\n   Öneri: ${o.recommendation}\n`);
  }

  heading(`MÜŞTERİ KAYBI — ${churn.length} müşteri`);
  for (const c of churn) {
    console.log(`🟠 Kayıp riski: ${c.message}\n   Öneri: ${c.recommendation}\n`);
  }

  heading('MARJ ANALİZİ — en düşük marjlı 3 ürün (son 90 gün)');
  for (const m of margins.slice(0, 3)) {
    const sign = m.marginPct < 0 ? '−' : '';
    console.log(
      `${m.product.name.padEnd(28)} ort. fiyat ${formatCurrency(m.avgSellingPrice).padStart(6)} | maliyet ${formatCurrency(m.unitCost).padStart(5)} | marj ${sign}${formatPercent(m.marginPct, 1)} [${m.status}]`,
    );
  }

  heading('SATIŞ — ciro neden değişti?');
  console.log(sales.explanation.summary);
  for (const b of sales.explanation.bullets) console.log(`  • ${b}`);

  heading(`ÖNERİLER — ${recommendations.counts.total} aksiyon (ilk 5)`);
  for (const [i, r] of recommendations.items.slice(0, 5).entries()) {
    console.log(`${i + 1}. [${PRIORITY_LABEL[r.priority]}] ${r.title} — ${r.impactLabel}: ${formatCurrency(r.impactAmount)}`);
  }

  // ── Senaryo doğrulaması ──
  heading('ENJEKTE EDİLEN SENARYOLARIN DOĞRULANMASI');
  const decline = SCENARIOS.salesDeclineWithOverstock;
  const surge = SCENARIOS.regionalDemandSurge;
  const declineRisk = risks.find((r) => r.product.sku === decline.sku);
  const surgeOpportunity = opportunities.find((o) => o.product.sku === surge.sku && o.region.name === surge.regionName);
  const checks = [
    {
      name:
        `a) ${declineRisk?.product.name ?? decline.sku}: satış düşüşü + fazla stok → Risk`,
      detail: declineRisk
        ? `satış ${formatPercent(declineRisk.metrics.salesChangePct ?? 0)} düştü, stok ~${formatNumber(declineRisk.metrics.monthsOfStock ?? 0, 1)} ay`
        : 'bulunamadı',
      ok: !!declineRisk && declineRisk.signals.includes('sales_decline') && declineRisk.signals.includes('overstock'),
    },
    {
      name: `b) ${surgeOpportunity?.product.name ?? surge.sku} @ ${surge.regionName}: 3 haftalık artış → Fırsat`,
      detail: surgeOpportunity
        ? `satış ${formatPercent(surgeOpportunity.metrics.growthPct)} arttı, transfer: +${formatNumber(surgeOpportunity.metrics.transfer?.units ?? 0)} adet (${surgeOpportunity.metrics.transfer?.fromRegion.name ?? '-'} → ${surge.regionName})`
        : 'bulunamadı',
      ok: !!surgeOpportunity?.metrics.transfer,
    },
    ...SCENARIOS.silentDealers.customerNames.map((name) => {
      const item = churn.find((c) => c.customer.name === name);
      return {
        name: `c) ${name}: sessiz bayi → Müşteri Kaybı`,
        detail: item
          ? `medyan aralık ${item.metrics.medianIntervalDays} gün, ${item.metrics.daysSinceLastOrder} gündür sessiz (${formatNumber(item.metrics.silenceRatio, 1)}×)`
          : 'bulunamadı',
        ok: !!item,
      };
    }),
  ];
  for (const check of checks) console.log(`${check.ok ? '✅' : '❌'} ${check.name}\n     ${check.detail}`);

  const unexpectedChurn = churn.filter((c) => !SCENARIOS.silentDealers.customerNames.some((n) => n === c.customer.name));
  console.log(`\nYanlış kayıp alarmı (düzenli müşteri işaretlendi): ${unexpectedChurn.length}`);

  const failed = checks.filter((c) => !c.ok).length;
  console.log(failed === 0 ? '\nTüm senaryolar veriden doğru tespit edildi.' : `\n${failed} senaryo tespit edilemedi!`);
  process.exitCode = failed === 0 ? 0 : 1;
} finally {
  await db.close();
}
