/**
 * RSS 2.0 ve Atom beslemelerini okur (ek kütüphane yok). Yalnızca başlık, bağlantı, kısa özet ve tarih alınır;
 * haber metni gerektiğinde ayrıca okunur (bkz. article.ts).
 */

export interface FeedItem {
  title: string;
  link: string;
  summary: string;
  /** ISO zaman damgası; tarih okunamazsa null */
  publishedAt: string | null;
}

const MAX_BYTES = 3 * 1024 * 1024;
const TIMEOUT_MS = 12_000;
const MAX_SUMMARY = 400;

const NAMED_ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, entity: string) => {
    if (entity[0] === '#') {
      const code = entity[1]?.toLowerCase() === 'x' ? parseInt(entity.slice(2), 16) : parseInt(entity.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : '';
    }
    return NAMED_ENTITIES[entity.toLowerCase()] ?? match;
  });
}

/** CDATA'yı açar, HTML etiketlerini ve fazla boşlukları temizler. */
function cleanText(raw: string | undefined): string {
  if (!raw) return '';
  let text = raw.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1');
  text = decodeEntities(text);
  // Bazı beslemeler HTML'yi kaçışlı gönderir: çözüldükten sonra etiketleri tekrar temizle
  text = text.replace(/<[^>]*>/g, ' ');
  return decodeEntities(text).replace(/\s+/g, ' ').trim();
}

function tag(block: string, name: string): string | undefined {
  const match = block.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, 'i'));
  return match?.[1];
}

function safeLink(value: string): string | null {
  try {
    const url = new URL(value.trim());
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : null;
  } catch {
    return null;
  }
}

function toIso(value: string | undefined): string | null {
  const text = cleanText(value);
  if (!text) return null;
  const time = Date.parse(text);
  return Number.isNaN(time) ? null : new Date(time).toISOString();
}

export function parseFeed(xml: string): FeedItem[] {
  const items: FeedItem[] = [];
  const blocks = xml.match(/<item[\s>][\s\S]*?<\/item>/gi) ?? xml.match(/<entry[\s>][\s\S]*?<\/entry>/gi) ?? [];
  for (const block of blocks) {
    const title = cleanText(tag(block, 'title'));
    // RSS: <link>…</link> · Atom: <link href="…"/>
    const rawLink = tag(block, 'link') ?? block.match(/<link[^>]*href="([^"]+)"/i)?.[1] ?? tag(block, 'guid') ?? '';
    const link = safeLink(cleanText(rawLink));
    if (!title || !link) continue;
    const summary = cleanText(tag(block, 'description') ?? tag(block, 'summary') ?? tag(block, 'content'));
    items.push({
      title: title.slice(0, 300),
      link,
      summary: summary.length > MAX_SUMMARY ? `${summary.slice(0, MAX_SUMMARY).trimEnd()}…` : summary,
      publishedAt: toIso(tag(block, 'pubDate') ?? tag(block, 'published') ?? tag(block, 'updated') ?? tag(block, 'dc:date')),
    });
  }
  return items;
}

export type FeedFetcher = (url: string) => Promise<FeedItem[]>;

/** Beslemeyi indirir ve okur. Boyut ve süre sınırlıdır; hata halinde fırlatır (çağıran diğer kaynaklarla devam eder). */
export const fetchFeed: FeedFetcher = async (url) => {
  const response = await fetch(url, {
    headers: { 'User-Agent': 'Clario/1.0 (+https://github.com/clario)', Accept: 'application/rss+xml, application/xml, text/xml' },
    signal: AbortSignal.timeout(TIMEOUT_MS),
    redirect: 'follow',
  });
  if (!response.ok) throw new Error(`${url} → ${response.status}`);
  const length = Number(response.headers.get('content-length') ?? 0);
  if (length > MAX_BYTES) throw new Error(`${url} çok büyük`);
  const text = await response.text();
  if (text.length > MAX_BYTES) throw new Error(`${url} çok büyük`);
  return parseFeed(text);
};
