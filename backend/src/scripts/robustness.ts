/**
 * Dayanıklılık testi: seed'i 20 farklı "bugün" tarihiyle bellek içinde yeniden üretir ve
 * enjekte edilen senaryoların her seferinde bulunup bulunmadığını, kaç yanlış alarm
 * çıktığını raporlar. Tek bir şanslı veri setine güvenmemek için.
 *
 *   npm run verify:robustness
 */
import { buildAnalysisContext } from '../analysis/context.js';
import { detectCustomerChurn, detectOpportunities, detectRisks } from '../analytics.js';
import { openDatabase } from '../db/index.js';
import { seedDatabase } from '../seed/generate.js';
import { SCENARIOS } from '../seed/scenarios.js';
import { addDays } from '../utils/dates.js';

const RUNS = 20;
const STEP_DAYS = 13; // haftanın farklı günlerine denk gelsin diye 7'nin katı değil
const FIRST_AS_OF = '2026-01-15';

const decline = SCENARIOS.salesDeclineWithOverstock;
const surge = SCENARIOS.regionalDemandSurge;
const silent = new Set<string>(SCENARIOS.silentDealers.customerNames);
const pct = (v: number | null | undefined) => (v == null ? '-' : `${(v * 100).toFixed(0)}%`);

const rows: Record<string, string | number>[] = [];
for (let i = 0; i < RUNS; i++) {
  const asOf = addDays(FIRST_AS_OF, i * STEP_DAYS);
  const db = await openDatabase(':memory:');
  const summary = await seedDatabase(db, { asOf });
  const ctx = buildAnalysisContext(asOf);
  const [risks, opportunities, churn] = await Promise.all([
    detectRisks(db, ctx),
    detectOpportunities(db, ctx),
    detectCustomerChurn(db, ctx),
  ]);
  await db.close();

  const risk = risks.find((r) => r.product.sku === decline.sku);
  const opportunity = opportunities.find((o) => o.product.sku === surge.sku && o.region.name === surge.regionName);
  rows.push({
    asOf,
    satır: summary.orderItems,
    'a) düşüş': pct(risk?.metrics.salesChangePct),
    'a) stok ay': risk?.metrics.monthsOfStock?.toFixed(1) ?? '-',
    a: risk?.signals.includes('sales_decline') && risk.signals.includes('overstock') ? '✅' : '❌',
    'b) artış': pct(opportunity?.metrics.growthPct),
    b: opportunity ? '✅' : '❌',
    c: `${churn.filter((c) => silent.has(c.customer.name)).length}/${silent.size}`,
    'ek fırsat': opportunities.length - (opportunity ? 1 : 0),
    'yanlış kayıp': churn.filter((c) => !silent.has(c.customer.name)).length,
  });
}

console.table(rows);
const hits = (key: 'a' | 'b') => rows.filter((r) => r[key] === '✅').length;
const cHits = rows.filter((r) => r.c === `${silent.size}/${silent.size}`).length;
console.log(`\na) ${hits('a')}/${RUNS}   b) ${hits('b')}/${RUNS}   c) ${cHits}/${RUNS}`);
process.exitCode = hits('a') === RUNS && hits('b') === RUNS && cHits === RUNS ? 0 : 1;
