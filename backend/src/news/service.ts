import { createHash } from 'node:crypto';
import { normalizeText } from '../assistant/text.js';
import { CURRENCIES, type CurrencyCode } from '../currency/currencies.js';
import { ensureRates, type RateProvider } from '../currency/rates.js';
import type { DbClient } from '../db/types.js';
import { getBaseCurrency, getSetting, setSetting } from '../repositories/settingsRepository.js';
import { addDays, parseIsoDate } from '../utils/dates.js';
import { formatNumber, formatPercent } from '../utils/format.js';
import type { Article, ArticleFetcher } from './article.js';
import { buildSnapshot, describeImpact, findMentions } from './impacts.js';
import type { FeedFetcher, FeedItem } from './rss.js';
import { classify, themeLabel, type Direction, type ThemeId } from './themes.js';

/**
 * Ücretsiz haber kaynakları (RSS). Türkiye'deki işletmeler için Türkçe ekonomi haberleri, diğer ülkeler için
 * uluslararası İngilizce ekonomi haberleri. Yalnızca başlık, kısa özet ve bağlantı kullanılır.
 */
export const FEEDS = {
  tr: [
    { name: 'Anadolu Ajansı', url: 'https://www.aa.com.tr/tr/rss/default?cat=ekonomi' },
    { name: 'TRT Haber', url: 'https://www.trthaber.com/ekonomi_articles.rss' },
    { name: 'Habertürk', url: 'https://www.haberturk.com/rss/ekonomi.xml' },
    { name: 'Dünya', url: 'https://www.dunya.com/rss?dunya' },
  ],
  en: [
    { name: 'BBC', url: 'https://feeds.bbci.co.uk/news/business/rss.xml' },
    { name: 'CNBC', url: 'https://www.cnbc.com/id/10001147/device/rss/rss.html' },
    { name: 'The Guardian', url: 'https://www.theguardian.com/business/economics/rss' },
    { name: 'Anadolu Agency', url: 'https://www.aa.com.tr/en/rss/default?cat=economy' },
  ],
} as const;

type Language = keyof typeof FEEDS;

export type Relevance = 'high' | 'medium' | 'low';

export interface NewsItem {
  id: string;
  /** news: haber başlığı · fx: kur hareketinden üretilen sinyal */
  kind: 'news' | 'fx';
  theme: ThemeId;
  themeLabel: string;
  direction: Direction;
  title: string;
  summary: string;
  source: string;
  url: string | null;
  publishedAt: string | null;
  relevance: Relevance;
  /** Haberde geçen bölge/kategori/ürün adlarınız */
  mentions: { label: string; kind: 'region' | 'category' | 'product' }[];
  effect: string;
  details: string[];
  action: string;
}

export interface NewsFeed {
  items: NewsItem[];
  unread: number;
  /** Kaynaklara ulaşılabildi mi */
  sources: { name: string; ok: boolean }[];
  updatedAt: string | null;
}

const CACHE_MS = 10 * 60 * 1000;
const MAX_AGE_DAYS = 7;
const MAX_ITEMS = 15;
/** Kur sinyali için eşik: 30 günde bu kadar veya daha fazla değişim */
const FX_THRESHOLD = 0.02;
export const SEEN_KEY = 'news_seen_at';

interface CachedFeed {
  items: (FeedItem & { source: string })[];
  sources: { name: string; ok: boolean }[];
  fetchedAt: number;
}

const RANK: Record<Relevance, number> = { high: 3, medium: 2, low: 1 };
const LOCAL_THEMES = new Set<ThemeId>(['disaster', 'supply', 'demand']);
const hashId = (value: string) => createHash('sha256').update(value).digest('hex').slice(0, 16);

export interface NewsService {
  getFeed(db: DbClient): Promise<NewsFeed>;
  markSeen(db: DbClient): Promise<void>;
  /** Gündemdeki bir haberin metni (Clario içinde okumak için); haber bulunamazsa null */
  getArticle(id: string): Promise<(Article & { url: string; source: string }) | null>;
}

/**
 * Gündem: haber başlıkları kurallarla temalara ayrılır (faiz, kur, enflasyon, enerji…), kullanıcının verisiyle
 * ilişkilendirilir ve "olası etki → öneri" olarak sunulur. Yapay zekâ veya API anahtarı kullanılmaz.
 * Beslemeler tüm kullanıcılar için ortaktır ve 10 dakika önbellekte tutulur.
 */
export function createNewsService(options: {
  fetchFeed: FeedFetcher;
  rates: RateProvider;
  /** Haber metni okuyucu; verilmezse yalnızca özet gösterilir */
  fetchArticle?: ArticleFetcher;
  now?: () => Date;
}): NewsService {
  const cache = new Map<Language, CachedFeed>();
  const articles = new Map<string, Promise<Article>>();
  const pending = new Map<Language, Promise<CachedFeed>>();
  const now = () => options.now?.() ?? new Date();

  async function load(language: Language): Promise<CachedFeed> {
    const cached = cache.get(language);
    if (cached && now().getTime() - cached.fetchedAt < CACHE_MS) return cached;
    let request = pending.get(language);
    if (!request) {
      request = (async () => {
        const results = await Promise.allSettled(FEEDS[language].map((feed) => options.fetchFeed(feed.url)));
        const items = results.flatMap((result, i) => (result.status === 'fulfilled' ? result.value.map((item) => ({ ...item, source: FEEDS[language][i]!.name })) : []));
        const sources = results.map((result, i) => ({ name: FEEDS[language][i]!.name, ok: result.status === 'fulfilled' }));
        for (const [i, result] of results.entries()) {
          if (result.status === 'rejected') console.warn(`[haber] ${FEEDS[language][i]!.name} okunamadı:`, String(result.reason));
        }
        const entry = { items, sources, fetchedAt: now().getTime() };
        // Hiçbir kaynağa ulaşılamadıysa eski önbellek korunur
        if (items.length > 0 || !cached) cache.set(language, entry);
        return items.length > 0 || !cached ? entry : cached;
      })().finally(() => pending.delete(language));
      pending.set(language, request);
    }
    return request;
  }

  /** Temel para biriminin USD/EUR karşısındaki 30 günlük değişimi (≥%2 ise sinyal). */
  async function fxSignal(db: DbClient, base: CurrencyCode): Promise<NewsItem | null> {
    try {
      await ensureRates(db, options.rates);
    } catch {
      return null;
    }
    let best: { target: CurrencyCode; change: number; price: number; date: string } | null = null;
    for (const target of ['USD', 'EUR'] as const) {
      if (target === base) continue;
      const rows = await db.query<{ date: string; price: number }>(
        `SELECT b.rate_date AS date, b.per_eur / d.per_eur AS price
         FROM fx_rates b JOIN fx_rates d ON d.rate_date = b.rate_date AND d.currency = ?
         WHERE b.currency = ? ORDER BY b.rate_date DESC LIMIT 1`,
        [target, base],
      );
      const latest = rows[0];
      if (!latest) continue;
      const before = await db.queryOne<{ price: number }>(
        `SELECT b.per_eur / d.per_eur AS price FROM fx_rates b JOIN fx_rates d ON d.rate_date = b.rate_date AND d.currency = ?
         WHERE b.currency = ? AND b.rate_date <= ? ORDER BY b.rate_date DESC LIMIT 1`,
        [target, base, addDays(latest.date, -30)],
      );
      if (!before) continue;
      const change = latest.price / before.price - 1;
      if (Math.abs(change) >= FX_THRESHOLD && (!best || Math.abs(change) > Math.abs(best.change))) {
        best = { target, change, price: latest.price, date: latest.date };
      }
    }
    if (!best) return null;
    const direction: Direction = best.change > 0 ? 'up' : 'down';
    const baseName = CURRENCIES[base].label;
    const targetName = CURRENCIES[best.target].label;
    return {
      id: `fx-${best.target}-${best.date}`,
      kind: 'fx',
      theme: 'currency',
      themeLabel: themeLabel('currency'),
      direction,
      title: `${targetName} son 30 günde ${baseName} karşısında ${formatPercent(best.change, 1)} ${direction === 'up' ? 'değer kazandı' : 'değer kaybetti'}`,
      summary: `1 ${best.target} = ${formatNumber(best.price, 4)} ${base}`,
      source: 'ECB referans kurları',
      url: null,
      publishedAt: parseIsoDate(best.date).toISOString(),
      relevance: Math.abs(best.change) >= 0.05 ? 'high' : 'medium',
      mentions: [],
      ...describeImpact('currency', direction, await buildSnapshot(db)),
    };
  }

  return {
    async getFeed(db) {
      const country = await getSetting(db, 'profile_country');
      const language: Language = !country || country === 'TR' ? 'tr' : 'en';
      const [feed, snapshot, base, seenAt] = await Promise.all([load(language), buildSnapshot(db), getBaseCurrency(db), getSetting(db, SEEN_KEY)]);
      const cutoff = now().getTime() - MAX_AGE_DAYS * 86_400_000;

      const seen = new Set<string>();
      const items: (NewsItem & { score: number })[] = [];
      for (const item of feed.items) {
        if (item.publishedAt && Date.parse(item.publishedAt) < cutoff) continue;
        const classification = classify(item.title, item.summary, language);
        if (!classification) continue;
        const dedupe = `${classification.theme}|${normalizeText(item.title).slice(0, 50)}`;
        if (seen.has(dedupe) || seen.has(item.link)) continue;
        seen.add(dedupe);
        seen.add(item.link);
        // Şehir adı yalnızca yerel olaylarda (afet, tedarik, talep) anlamlıdır; kategori/ürün adı her temada
        const mentions = findMentions(`${item.title} ${item.summary}`, snapshot).filter(
          (m) => m.kind !== 'region' || LOCAL_THEMES.has(classification.theme),
        );
        const fresh = item.publishedAt && now().getTime() - Date.parse(item.publishedAt) < 86_400_000 ? 1 : 0;
        const score = classification.score + (classification.direction ? 1 : 0) + mentions.length * 3 + fresh;
        const relevance: Relevance = mentions.length > 0 ? 'high' : score >= 5 ? 'medium' : 'low';
        items.push({
          id: hashId(item.link),
          kind: 'news',
          theme: classification.theme,
          themeLabel: classification.label,
          direction: classification.direction,
          title: item.title,
          summary: item.summary,
          source: item.source,
          url: item.link,
          publishedAt: item.publishedAt,
          relevance,
          mentions: mentions.map(({ label, kind }) => ({ label, kind })),
          ...describeImpact(classification.theme, classification.direction, snapshot),
          score,
        });
      }

      const fx = await fxSignal(db, base);
      const ranked = [...(fx ? [{ ...fx, score: 99 }] : []), ...items]
        .sort((a, b) => RANK[b.relevance] - RANK[a.relevance] || (b.publishedAt ?? '').localeCompare(a.publishedAt ?? '') || b.score - a.score)
        .slice(0, MAX_ITEMS)
        .map(({ score: _score, ...item }) => item);

      const seenTime = seenAt ? Date.parse(seenAt) : 0;
      return {
        items: ranked,
        unread: ranked.filter((i) => i.relevance !== 'low' && Date.parse(i.publishedAt ?? now().toISOString()) > seenTime).length,
        sources: feed.sources,
        updatedAt: feed.fetchedAt ? new Date(feed.fetchedAt).toISOString() : null,
      };
    },

    async markSeen(db) {
      await setSetting(db, SEEN_KEY, now().toISOString());
    },

    async getArticle(id) {
      // Yalnızca beslemelerden gelen bağlantılar açılır: istemci rastgele adres isteyemez
      const item = [...cache.values()].flatMap((feed) => feed.items).find((entry) => hashId(entry.link) === id);
      if (!item) return null;
      const empty: Article = { title: null, image: null, paragraphs: [] };
      if (!options.fetchArticle) return { ...empty, url: item.link, source: item.source };
      let request = articles.get(id);
      if (!request) {
        request = options.fetchArticle(item.link);
        articles.set(id, request);
        // Başarısız istek önbellekte kalmaz; önbellek en fazla 40 haber tutar
        request.catch(() => articles.delete(id));
        if (articles.size > 40) articles.delete(articles.keys().next().value!);
      }
      try {
        return { ...(await request), url: item.link, source: item.source };
      } catch (error) {
        console.warn(`[haber] metin okunamadı (${item.link}):`, String(error));
        return { ...empty, url: item.link, source: item.source };
      }
    },
  };
}
