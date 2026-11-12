import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import type { AnalysisContext } from '../src/analysis/context.js';
import { assignSegments, detectChurnRisks, getCustomerActivity } from '../src/analysis/customers.js';
import { getMarginAnalysis } from '../src/analysis/margins.js';
import { detectOpportunities, significanceVsBaseline } from '../src/analysis/opportunities.js';
import { getRecommendations, prioritize } from '../src/analysis/recommendations.js';
import { detectRisks } from '../src/analysis/risks.js';
import { classifyCoverage } from '../src/analysis/stock.js';
import { HIGH_STOCK_MONTHS, LOW_STOCK_MONTHS } from '../src/config/thresholds.js';
import type { DbClient } from '../src/db/index.js';
import { SCENARIOS } from '../src/seed/scenarios.js';
import { median, pctChange } from '../src/utils/stats.js';
import { createSeededDb } from './helpers.js';

describe('istatistik yardımcıları', () => {
  it('medyan tek ve çift uzunlukta doğru hesaplanır', () => {
    assert.equal(median([7, 3, 5]), 5);
    assert.equal(median([4, 8, 6, 10]), 7);
    assert.equal(median([]), null);
  });

  it('oransal değişim önceki değer 0 iken tanımsızdır', () => {
    assert.equal(pctChange(72, 100), -0.28);
    assert.equal(pctChange(5, 0), null);
    assert.equal(pctChange(0, 0), 0);
  });

  it('stok kapsamı eşiklere göre sınıflandırılır', () => {
    assert.equal(classifyCoverage(100, LOW_STOCK_MONTHS - 0.1), 'stockout_risk');
    assert.equal(classifyCoverage(100, HIGH_STOCK_MONTHS + 0.1), 'excess');
    assert.equal(classifyCoverage(100, 2.5), 'healthy');
    assert.equal(classifyCoverage(100, null), 'excess'); // satış yok, stok var → ölü stok
    assert.equal(classifyCoverage(0, null), 'inactive');
  });

  it('ABC segmentasyonu cironun ilk %80\'ini A sayar', () => {
    const segments = assignSegments([
      { id: 1, revenue: 700 },
      { id: 2, revenue: 200 },
      { id: 3, revenue: 60 },
      { id: 4, revenue: 40 },
    ]);
    assert.deepEqual([...segments.entries()].sort(), [[1, 'A'], [2, 'A'], [3, 'B'], [4, 'C']]);
  });

  it('anlamlılık testi olağan dalgalanmayı eler, belirgin artışı yakalar', () => {
    const noisyWeeks = [80, 120, 95, 110, 70, 130, 100, 90, 105, 115, 85, 100];
    // Beklenen 3 haftalık satış = 300, sapma ≈ 30
    assert.ok(significanceVsBaseline(340, noisyWeeks).zScore < 2); // ~%13 yukarıda: dalgalanma içinde
    assert.ok(significanceVsBaseline(450, noisyWeeks).zScore > 2); // %50 yukarıda: anlamlı
  });

  it('öncelik etkinin aylık ciroya oranıyla belirlenir', () => {
    assert.equal(prioritize(50_000, 'medium', 1_000_000).priority, 'high');
    assert.equal(prioritize(15_000, 'medium', 1_000_000).priority, 'medium');
    assert.equal(prioritize(1_000, 'medium', 1_000_000).priority, 'low');
    assert.equal(prioritize(1_000, 'high', 1_000_000).priority, 'medium');
  });
});

describe('enjekte edilen senaryoların tespiti', () => {
  let db: DbClient;
  let ctx: AnalysisContext;

  before(async () => {
    ({ db, ctx } = await createSeededDb());
  });
  after(async () => {
    await db.close();
  });

  it('1) satış düşüşü + fazla stok yaşayan ürün risk olarak işaretlenir', async () => {
    const risks = await detectRisks(db, ctx);
    const risk = risks.find((r) => r.product.sku === SCENARIOS.salesDeclineWithOverstock.sku);
    assert.ok(risk, 'senaryo ürünü risk listesinde olmalı');
    assert.deepEqual(risk.signals, ['sales_decline', 'overstock']);
    assert.ok(risk.metrics.salesChangePct! <= -0.15);
    assert.ok(risk.metrics.monthsOfStock! > 4 && risk.metrics.monthsOfStock! < 6.5);
    assert.equal(risk.severity, 'high');
    assert.match(risk.recommendation, /Yeni sipariş oluşturma/);
  });

  it('2) bölgesel satış artışı fırsat olarak işaretlenir ve stok transferi önerilir', async () => {
    const { sku, regionName } = SCENARIOS.regionalDemandSurge;
    const opportunities = await detectOpportunities(db, ctx);
    const opportunity = opportunities.find((o) => o.product.sku === sku && o.region.name === regionName);
    assert.ok(opportunity, 'senaryo ürün-bölge kombinasyonu fırsat listesinde olmalı');
    assert.ok(opportunity.metrics.growthPct >= 0.2);
    assert.ok(opportunity.metrics.transfer, 'transfer önerisi olmalı');
    assert.notEqual(opportunity.metrics.transfer.fromRegion.name, regionName);
    assert.ok(opportunity.metrics.transfer.units > 0 && opportunity.metrics.transfer.units % 10 === 0);
  });

  it('3) ~8 haftadır sessiz kalan bayiler kayıp riski olarak işaretlenir', async () => {
    const churn = await detectChurnRisks(db, ctx);
    const names = churn.map((c) => c.customer.name).sort();
    for (const expected of SCENARIOS.silentDealers.customerNames) {
      assert.ok(names.includes(expected), `${expected} kayıp riski listesinde olmalı`);
    }
    for (const item of churn) assert.ok(item.metrics.silenceRatio >= 2.5);
  });

  it('düzenli sipariş veren müşteriler kayıp riski sayılmaz', async () => {
    const activity = await getCustomerActivity(db, ctx);
    const silent = new Set<string>(SCENARIOS.silentDealers.customerNames);
    const falsePositives = activity.filter((a) => a.status === 'churn_risk' && !silent.has(a.customer.name));
    assert.deepEqual(falsePositives.map((a) => a.customer.name), []);
  });

  it('marj analizi maliyetin altında satılan ürünü en başa koyar', async () => {
    const margins = await getMarginAnalysis(db, ctx);
    assert.equal(margins[0]!.product.sku, 'AMB-002');
    assert.equal(margins[0]!.status, 'loss');
    for (let i = 1; i < margins.length; i++) assert.ok(margins[i - 1]!.marginPct <= margins[i]!.marginPct);
  });

  it('öneriler risk, fırsat ve kaybı birleştirip etkiye göre sıralar', async () => {
    const recs = await getRecommendations(db, ctx);
    assert.ok(recs.counts.bySource.risk > 0 && recs.counts.bySource.opportunity > 0 && recs.counts.bySource.churn > 0);
    for (let i = 1; i < recs.items.length; i++) {
      assert.ok(recs.items[i - 1]!.priorityScore >= recs.items[i]!.priorityScore);
    }
  });
});
