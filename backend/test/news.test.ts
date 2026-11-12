import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { describe, it } from 'node:test';
import { askAssistant } from '../src/assistant/index.js';
import type { RateProvider, RateSeries } from '../src/currency/rates.js';
import { openDatabase } from '../src/db/index.js';
import { parseFeed, type FeedItem } from '../src/news/rss.js';
import { createNewsService, FEEDS } from '../src/news/service.js';
import { classify } from '../src/news/themes.js';
import { addDays, daysBetween, todayIso } from '../src/utils/dates.js';
import { createSeededDb, createTestApp } from './helpers.js';

const NOW = new Date('2026-09-27T12:00:00Z');
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000).toISOString();
const item = (title: string, hours = 2, summary = ''): FeedItem => ({ title, link: `https://haber.example/${encodeURIComponent(title)}`, summary, publishedAt: hoursAgo(hours) });

const noRates: RateProvider = { source: 'yok', fetchRates: () => Promise.reject(new Error('ağ yok')) };

describe('RSS okuma', () => {
  it('CDATA, HTML ve karakter kodları temizlenir; güvensiz bağlantılar atılır', () => {
    const xml = `<?xml version="1.0"?><rss><channel><title>Kaynak</title>
      <item><title><![CDATA[Merkez Bankası faizi &quot;sabit&quot; tuttu]]></title>
        <link>https://aa.example/1</link>
        <description><![CDATA[<img src="x.jpg"/>Karar <b>beklentilere</b> uygun &amp; net.]]></description>
        <pubDate>Sun, 27 Sep 2026 13:45:03 +0300</pubDate></item>
      <item><title>Kötü bağlantı</title><link>javascript:alert(1)</link></item>
      <item><title>&#304;hracat &#x131;l&#305;ml&#305;</title><link>https://aa.example/2</link></item>
    </channel></rss>`;
    assert.deepEqual(parseFeed(xml), [
      { title: 'Merkez Bankası faizi "sabit" tuttu', link: 'https://aa.example/1', summary: 'Karar beklentilere uygun & net.', publishedAt: '2026-09-27T10:45:03.000Z' },
      { title: 'İhracat ılımlı', link: 'https://aa.example/2', summary: '', publishedAt: null },
    ]);
  });

  it('Atom beslemesi', () => {
    const xml = `<feed><entry><title>Oil prices rise</title><link href="https://x.example/a"/><updated>2026-09-26T08:00:00Z</updated><summary>Brent up</summary></entry></feed>`;
    assert.equal(parseFeed(xml)[0]?.link, 'https://x.example/a');
  });
});

describe('haber sınıflandırma (kurallar, yapay zekâ yok)', () => {
  const cases: [string, 'tr' | 'en', string | null, 'up' | 'down' | null][] = [
    ['Merkez Bankası politika faizini 250 baz puan artırdı', 'tr', 'interest', 'up'],
    ['Fed faiz indirimine gitti', 'tr', 'interest', 'down'],
    ['Dolar rekor kırdı', 'tr', 'currency', 'up'],
    ['TL dolar karşısında değer kazandı', 'tr', 'currency', 'down'],
    ['Enflasyon eylülde yüzde 3 arttı', 'tr', 'inflation', 'up'],
    ['Brent petrolün varili geriledi', 'tr', 'energy', 'down'],
    ['Asgari ücrete ara zam kararı', 'tr', 'wages', 'up'],
    ["Bursa'da sel felaketi", 'tr', 'disaster', null],
    ['İhracat 5 milyar dolar arttı', 'tr', 'trade', 'up'],
    ['Bakan fuarın açılışına katıldı', 'tr', null, null],
    ['Boğazda kortej: savaş gemileri geçiş yaptı', 'tr', null, null],
    ["DASK'tan depremzedelere ödeme", 'tr', null, null],
    ["Türkiye'nin elektrik kurulu gücünde yenilenebilirin payı artıyor", 'tr', null, null], // fiyat değil: gündeme girmez
    ['Akaryakıt fiyatlarına zam geldi', 'tr', 'energy', 'up'],
    ['Limanlarda grev: konteyner sevkiyatı durdu', 'tr', 'supply', 'up'],
    ['Türkiye küresel tedarik zincirinde öne çıkıyor', 'tr', 'supply', null],
    ['Fed cuts interest rates by a quarter point', 'en', 'interest', 'down'],
    ['Oil prices surge after supply fears', 'en', 'energy', 'up'],
    ['Football club signs new striker', 'en', null, null],
  ];
  for (const [title, language, theme, direction] of cases) {
    it(title, () => {
      const result = classify(title, '', language);
      assert.equal(result?.theme ?? null, theme);
      if (theme) assert.equal(result?.direction, direction);
    });
  }
});

describe('gündem servisi', () => {
  const feeds = (items: FeedItem[]) => {
    const calls: string[] = [];
    return {
      calls,
      fetchFeed: async (url: string) => {
        calls.push(url);
        if (url === FEEDS.tr[1].url) throw new Error('kaynak kapalı');
        return url === FEEDS.tr[0].url ? items : [];
      },
    };
  };

  it('haberleri işletmeyle ilişkilendirir: bölgesi geçen haber öne çıkar, etki verinizle açıklanır', async () => {
    const { db } = await createSeededDb();
    const source = feeds([
      item('Merkez Bankası politika faizini 250 baz puan artırdı', 3),
      item("Bursa'da sel felaketi: sanayi bölgesi sular altında", 5),
      item('Bakan fuarın açılışına katıldı', 1),
      item('Enflasyon beklentisi yükseldi', 24 * 9), // 7 günden eski: gösterilmez
    ]);
    const news = createNewsService({ fetchFeed: source.fetchFeed, rates: noRates, now: () => NOW });
    const feed = await news.getFeed(db);

    assert.deepEqual(feed.items.map((i) => i.theme), ['disaster', 'interest']);
    const [disaster, interest] = feed.items;
    assert.equal(disaster!.relevance, 'high');
    assert.deepEqual(disaster!.mentions, [{ label: 'Bursa', kind: 'region' }]);
    assert.match(interest!.effect, /finansman maliyetleri artabilir/);
    assert.ok(interest!.details.some((d) => /Fazla stokta bağlı .+ sermayenin/.test(d)), interest!.details.join(' | '));
    assert.equal(feed.sources.find((s) => s.name === 'TRT Haber')?.ok, false, 'kapalı kaynak bildirilir');
    assert.equal(feed.unread, 2);

    await news.markSeen(db);
    assert.equal((await news.getFeed(db)).unread, 0);
    assert.equal(source.calls.length, FEEDS.tr.length, 'beslemeler 30 dakika önbellekte');
  });

  it('Türkiye dışındaki işletmeler için uluslararası kaynaklar kullanılır', async () => {
    const { db } = await createSeededDb();
    await db.execute("INSERT INTO settings (key, value) VALUES ('profile_country', 'DE')");
    const calls: string[] = [];
    const news = createNewsService({
      fetchFeed: async (url) => {
        calls.push(url);
        return [item('Oil prices surge after supply fears', 2)];
      },
      rates: noRates,
      now: () => NOW,
    });
    const feed = await news.getFeed(db);
    assert.deepEqual(calls, FEEDS.en.map((f) => f.url));
    assert.equal(feed.items[0]?.theme, 'energy');
  });

  it('kur hareketi sinyali: dolar 30 günde %2+ değişince gündemde ilk sırada', async () => {
    const { db } = await createSeededDb();
    const today = todayIso();
    const rising: RateProvider = {
      source: 'test',
      async fetchRates(from, to) {
        const series: RateSeries = new Map();
        for (let day = from; day <= to; day = addDays(day, 1)) {
          const progress = Math.min(Math.max(1 - daysBetween(day, today) / 30, 0), 1);
          series.set(day, { EUR: 1, USD: 1.1, TRY: 50 * (1 + 0.06 * progress), GBP: 0.85 });
        }
        return series;
      },
    };
    const news = createNewsService({ fetchFeed: async () => [], rates: rising, now: () => NOW });
    const [fx] = (await news.getFeed(db)).items;
    assert.equal(fx?.kind, 'fx');
    assert.match(fx!.title, /ABD doları son 30 günde Türk lirası karşısında %6(,0)? değer kazandı/);
    assert.equal(fx!.relevance, 'high');
    assert.match(fx!.effect, /İthal ürün ve hammadde maliyetleri artabilir/);
  });

  it('API ve asistan: bildirimler, okundu işareti ve "piyasa durumu" sorusu', async () => {
    const { db } = await createSeededDb();
    const news = createNewsService({
      fetchFeed: async (url) => (url === FEEDS.tr[0].url ? [item('Dolar rekor kırdı', 1), item('Asgari ücrete ara zam kararı', 2)] : []),
      rates: noRates,
      now: () => NOW,
    });
    const server = createTestApp(db, { news }).listen(0);
    await new Promise<void>((resolve) => server.once('listening', resolve));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
    try {
      const feed = (await (await fetch(`${base}/news`)).json()) as { items: { theme: string }[]; unread: number };
      assert.deepEqual(feed.items.map((i) => i.theme).sort(), ['currency', 'wages']);
      assert.equal(feed.unread, 2);
      assert.equal((await fetch(`${base}/news/seen`, { method: 'POST' })).status, 204);
      assert.equal(((await (await fetch(`${base}/news`)).json()) as { unread: number }).unread, 0);
    } finally {
      server.close();
    }

    const answer = await askAssistant(db, 'Piyasa durumu risklerimi nasıl etkiler?', { news });
    assert.equal(answer.intent, 'market');
    assert.match(answer.answer, /Döviz kuru: Dolar rekor kırdı/);
    assert.match(answer.answer, /Olası etki: İthal ürün/);
    assert.match(answer.answer, /kesin tahmin değildir/);
    assert.equal(answer.sources.length, 2);
    await db.close();
  });

  it('gündem sorusu henüz satış verisi olmayan hesapta da cevaplanır', async () => {
    const db = await openDatabase(':memory:');
    const news = createNewsService({ fetchFeed: async (url) => (url === FEEDS.tr[0].url ? [item('Dolar rekor kırdı', 1)] : []), rates: noRates, now: () => NOW });
    const answer = await askAssistant(db, 'Güncel gündem beni nasıl etkiler?', { news });
    assert.equal(answer.intent, 'market');
    assert.match(answer.answer, /Dolar rekor kırdı/);
    await assert.rejects(askAssistant(db, 'Satışlar neden düştü?', { news }), /Henüz satış verisi yok/);
    await db.close();
  });
});

describe('haber metni (Clario içinde okuma)', () => {
  it('JSON-LD gövdesi yalnızca özetse sayfadaki paragraflar kullanılır; dipnot ve paylaşım satırları atılır', async () => {
    const { extractArticle } = await import('../src/news/article.js');
    const long = (n: number) => `Bu ${n}. paragraf haberin gerçek metnidir ve okuyucuya ayrıntılı bilgi verir.`;
    const html = `<html><head><meta property="og:title" content="Faiz kararı &amp; piyasalar"><meta property="og:image" content="/img/a.jpg">
      <script type="application/ld+json">{"@type":"NewsArticle","articleBody":"Kısa özet cümlesi burada yer alıyor ve bitiyor."}</script>
      <script>var x = '<p>betik içi</p>'</script></head><body><nav><p>Menü bağlantıları çok uzun bir satır olsa da alınmamalı burada</p></nav>
      <article><p>${long(1)}</p><p>Haberi paylaş: WhatsApp Telegram</p><p>${long(2)}</p><p>${long(3)}</p>
      <p>Anadolu Ajansı web sitesinde, AA Haber Akış Sistemi (HAS) üzerinden abonelere sunulan haberler özetlenerek yayımlanmaktadır.</p>
      <p>İlgili başlık burada</p></article></body></html>`;
    const article = extractArticle(html, 'https://haber.example/a/1');
    assert.equal(article.title, 'Faiz kararı & piyasalar');
    assert.equal(article.image, 'https://haber.example/img/a.jpg');
    assert.deepEqual(article.paragraphs, [long(1), long(2), long(3)]);
  });

  it('tek parça uzun gövde okunabilir paragraflara bölünür', async () => {
    const { extractArticle } = await import('../src/news/article.js');
    const body = Array.from({ length: 30 }, (_, i) => `Cümle numarası ${i} burada ekonomiye dair bilgi verir.`).join(' ');
    const html = `<script type="application/ld+json">[{"@graph":[{"@type":"NewsArticle","articleBody":${JSON.stringify(body)}}]}]</script>`;
    const { paragraphs } = extractArticle(html, 'https://haber.example/b');
    assert.ok(paragraphs.length >= 3);
    assert.ok(paragraphs.every((p) => p.length <= 500));
    assert.equal(paragraphs.join(' '), body);
  });

  it('yalnızca gündemdeki haberler açılır; istemci rastgele adres isteyemez', async () => {
    const requested: string[] = [];
    const news = createNewsService({
      fetchFeed: async () => [item('Merkez Bankası politika faizini artırdı')],
      fetchArticle: async (url) => {
        requested.push(url);
        return { title: 'Başlık', image: null, paragraphs: ['Metin.'] };
      },
      rates: noRates,
      now: () => NOW,
    });
    const db = await openDatabase(':memory:');
    const feed = await news.getFeed(db);
    const id = feed.items.find((i) => i.kind === 'news')!.id;
    const article = await news.getArticle(id);
    assert.deepEqual(article?.paragraphs, ['Metin.']);
    assert.equal(article?.url, item('Merkez Bankası politika faizini artırdı').link);
    await news.getArticle(id); // önbellekten
    assert.equal(requested.length, 1);
    assert.equal(await news.getArticle('0000000000000000'), null);
    await db.close();
  });
});
