import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { extractEntities } from '../src/assistant/entities.js';
import { askAssistant } from '../src/assistant/index.js';
import { resolveIntent } from '../src/assistant/intents.js';
import { normalizeText } from '../src/assistant/text.js';
import type { DbClient } from '../src/db/index.js';
import { getProducts, getRegions } from '../src/repositories/catalogRepository.js';
import { createSeededDb } from './helpers.js';

describe('niyet eşleme', () => {
  it('Türkçe metni aksansız, küçük harfe çevirir', () => {
    assert.equal(normalizeText("Bursa'da SATIŞLAR neden düştü?"), 'bursa da satislar neden dustu');
    assert.equal(normalizeText('İSTANBUL ışık'), 'istanbul isik');
  });

  const cases: [string, string][] = [
    ['Bu ay neden satışlar düştü?', 'sales_change'],
    ['Ciromuz neden geriledi?', 'sales_change'],
    ['Hangi müşterileri kaybediyoruz?', 'churn'],
    ['Kayıp riski taşıyan müşteriler kimler?', 'churn'],
    ['Hangi ürün zarar ettiriyor?', 'margin'],
    ['Hangi ürünlerde fazla stok var?', 'inventory'],
    ["Bursa'daki dezenfektan stoğu ne durumda?", 'inventory'], // ünsüz yumuşaması: stok → stoğu
    ['Müşteri kaybı yaşıyor muyuz?', 'churn'], // kayıp → kaybı
    ["Bursa'da fırsat var mı?", 'opportunities'],
    ['Riskli ürünler hangileri?', 'risks'],
    ['Öncelikle ne yapmalıyım?', 'recommendations'],
    ['Genel durum nasıl?', 'summary'],
    ['En çok satan ürünler hangileri?', 'top_sellers'],
    ['Giderlerimiz ne kadar, kâr ediyor muyuz?', 'profit'],
  ];

  for (const [question, expected] of cases) {
    it(`"${question}" → ${expected}`, () => {
      assert.equal(resolveIntent(question).match?.intent.id, expected);
    });
  }

  it('ilgisiz soruyu hiçbir analize yönlendirmez', () => {
    assert.equal(resolveIntent('Yarın hava nasıl olacak?').match, null);
  });

  it('"karar" kelimesi kâr niyetini tetiklemez', () => {
    assert.notEqual(resolveIntent('Bir karar vermem lazım').match?.intent.id, 'profit');
  });
});

describe('asistan cevapları gerçek veriye dayanır', () => {
  let db: DbClient;

  before(async () => {
    ({ db } = await createSeededDb());
  });
  after(async () => {
    await db.close();
  });

  it('soru içindeki bölge ve ürün adlarını yakalar', async () => {
    const [regions, products] = await Promise.all([getRegions(db), getProducts(db)]);
    const entities = extractEntities("Bursa'da dezenfektan satışları nasıl?", regions, products);
    assert.deepEqual(entities.regions.map((r) => r.name), ['Bursa']);
    assert.deepEqual(entities.products.map((p) => p.sku), ['HJY-001']);
  });

  it('müşteri kaybı sorusu sessiz bayileri listeler', async () => {
    const response = await askAssistant(db, 'Hangi müşterileri kaybediyoruz?');
    assert.equal(response.intent, 'churn');
    assert.match(response.answer, /Boğaziçi Hijyen Ltd\./);
    assert.ok(response.items.length >= 3);
  });

  it('marj sorusu zarar eden ürünü adıyla verir', async () => {
    const response = await askAssistant(db, 'Hangi ürün zarar ettiriyor?');
    assert.equal(response.intent, 'margin');
    assert.match(response.answer, /Streç Film 30cm/);
  });

  it('bölge filtresi fırsat cevabına uygulanır', async () => {
    const response = await askAssistant(db, "Bursa'da hangi fırsatlar var?");
    assert.equal(response.intent, 'opportunities');
    assert.match(response.answer, /Filtre: Bursa bölgesi/);
    assert.match(response.answer, /Bursa bölgesinde El Dezenfektanı 1L/);
  });

  it('anlaşılamayan soruya öneri soruları döner', async () => {
    const response = await askAssistant(db, 'Yarın hava nasıl olacak?');
    assert.equal(response.intent, 'unknown');
    assert.ok(response.suggestions.length > 0);
  });
});

describe('asistan: müşteri profili ve sohbet', () => {
  it('müşteri adı (Türkçe ekle) tanınır ve profil anlatılır', async () => {
    const { askAssistant } = await import('../src/assistant/index.js');
    const { createSeededDb } = await import('./helpers.js');
    const { db } = await createSeededDb();
    const [customer] = await db.query<{ name: string }>('SELECT name FROM customers ORDER BY id LIMIT 1');
    const response = await askAssistant(db, `${customer!.name} ne durumda?`);
    assert.equal(response.intent, 'customer');
    assert.match(response.answer, /Toplam ciro/);
    assert.match(response.answer, /Son sipariş/);
    const kadikoy = await askAssistant(db, "Kadıköy Market'in son siparişi ne zaman?");
    assert.equal(kadikoy.intent, 'customer');
    assert.match(kadikoy.answer, /^Kadıköy Market Zinciri/);
    // Müşteri adı geçse de açık başka bir analiz isteniyorsa o analiz
    assert.equal((await askAssistant(db, 'Kadıköy Market stok durumu')).intent, 'inventory');
    await db.close();
  });

  it('selamlaşmaya veri gerektirmeden cevap verilir', async () => {
    const { askAssistant } = await import('../src/assistant/index.js');
    const { openDatabase } = await import('../src/db/index.js');
    const db = await openDatabase(':memory:');
    const response = await askAssistant(db, 'Merhaba');
    assert.equal(response.intent, 'greeting');
    assert.match(response.answer, /Ben Clario/);
    await db.close();
  });
});
