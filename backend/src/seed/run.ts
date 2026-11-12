/**
 * Analiz motorunu doğrulamak için test veritabanını (data/test.db) üretir.
 * Gerçek veritabanına (data/clario.db) dokunmaz; üretilen veri uygulamada görünmez.
 *
 * Kullanım:
 *   npm run seed                        → bugünün tarihine göre 6 aylık test verisi
 *   npm run seed -- --as-of=2026-06-30  → belirli bir "bugün" tarihine göre
 */
import { env } from '../config/env.js';
import { openDatabase } from '../db/index.js';
import { getRecordCounts } from '../repositories/catalogRepository.js';
import { formatCurrency, formatNumber } from '../utils/format.js';
import { seedDatabase } from './generate.js';

function readAsOfArgument(): string | undefined {
  const arg = process.argv.find((a) => a.startsWith('--as-of='));
  const value = arg?.split('=')[1];
  if (value && !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error(`Geçersiz --as-of değeri: ${value} (beklenen: YYYY-MM-DD)`);
  }
  return value;
}

const db = await openDatabase(env.testDatabasePath);
try {
  const started = performance.now();
  const summary = await seedDatabase(db, { asOf: readAsOfArgument() });
  const counts = await getRecordCounts(db);
  const elapsed = Math.round(performance.now() - started);

  console.log(`\nTest verisi üretildi (${elapsed} ms) → ${env.testDatabasePath}\n`);
  console.log(`  Dönem           : ${summary.startDate} → ${summary.asOf}`);
  console.log(`  Bölge           : ${counts.regions}`);
  console.log(`  Ürün            : ${counts.products}`);
  console.log(`  Çalışan         : ${counts.employees}`);
  console.log(`  Müşteri         : ${counts.customers}`);
  console.log(`  Sipariş         : ${formatNumber(counts.orders)}`);
  console.log(`  Satış kaydı     : ${formatNumber(summary.orderItems)} satır (sipariş kalemi: ürün × adet × fiyat)`);
  console.log(`  Stok kaydı      : ${summary.inventoryRows}`);
  console.log(`  Gider kaydı     : ${counts.expenses}`);
  console.log(`  Toplam ciro     : ${formatCurrency(summary.deliveredRevenue)}\n`);
} finally {
  await db.close();
}
