/**
 * Haber metnini Clario içinde okumak için sayfadan sade metin çıkarır ("okuma modu"). Önce sayfadaki yapısal veri
 * (JSON-LD NewsArticle.articleBody), yoksa <article> içindeki paragraflar kullanılır. Görsel, reklam ve betik alınmaz.
 */

export interface Article {
  title: string | null;
  image: string | null;
  paragraphs: string[];
}

export type ArticleFetcher = (url: string) => Promise<Article>;

const MAX_BYTES = 4 * 1024 * 1024;
const TIMEOUT_MS = 12_000;
const MAX_PARAGRAPHS = 80;
const MIN_PARAGRAPH = 40;

const NAMED_ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', hellip: '…', ndash: '–', mdash: '—' };

function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, entity: string) => {
    if (entity[0] === '#') {
      const code = entity[1]?.toLowerCase() === 'x' ? parseInt(entity.slice(2), 16) : parseInt(entity.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : '';
    }
    return NAMED_ENTITIES[entity.toLowerCase()] ?? match;
  });
}

const stripTags = (html: string) => decodeEntities(html.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]*>/g, ' ')).replace(/[ \t\r\f\v]+/g, ' ').trim();

/** Okuyucuya ait olmayan kalıp cümleler: kısa paragraflarda (çerez, abonelik, paylaşım düğmeleri vb.) */
const BOILERPLATE = /(çerez|cookie|abone ol|subscribe|newsletter|bülten|reklam|advertisement|paylaş|share this|whatsapp|telegram|yorum yap|sign up|giriş yap|log in|ilgili haber|read more|bunu da okuyun)/i;
/** Uzun olsa da her zaman atılanlar (ajans dipnotları, okur bildirimleri) */
const FOOTER = /(haber akış sistemi|bu haberde bir hata|okur temsilci|tüm hakları saklı|all rights reserved|personally affected|get in touch with us|news_share_description|subscription_contact|bbc indepth is the home|©)/i;

function meta(html: string, property: string): string | null {
  const pattern = new RegExp(`<meta[^>]+(?:property|name)=["']${property}["'][^>]*>`, 'i');
  const tag = html.match(pattern)?.[0];
  const content = tag?.match(/content=["']([^"']*)["']/i)?.[1];
  return content ? decodeEntities(content).trim() || null : null;
}

function safeHttpUrl(value: string | null, base: string): string | null {
  if (!value) return null;
  try {
    const url = new URL(value, base);
    return url.protocol === 'https:' ? url.href : null;
  } catch {
    return null;
  }
}

/** JSON-LD içindeki NewsArticle/Article gövdesi (iç içe @graph ve diziler dahil) */
function articleBodyFromJsonLd(html: string): string | null {
  for (const match of html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    let data: unknown;
    try {
      data = JSON.parse(match[1]!.trim());
    } catch {
      continue;
    }
    const queue: unknown[] = [data];
    while (queue.length > 0) {
      const node = queue.shift();
      if (Array.isArray(node)) queue.push(...node);
      else if (node && typeof node === 'object') {
        const record = node as Record<string, unknown>;
        if (typeof record.articleBody === 'string' && record.articleBody.trim().length > MIN_PARAGRAPH) return record.articleBody;
        if (record['@graph']) queue.push(record['@graph']);
      }
    }
  }
  return null;
}

function splitParagraphs(text: string): string[] {
  return text
    .split(/\n{1,}|(?<=[.!?…])\s{2,}/)
    .map((p) => p.replace(/\s+/g, ' ').trim())
    .filter((p) => p.length > 0);
}

function paragraphsFromHtml(html: string): string[] {
  // Gürültüyü at; varsa <article> bölümüne odaklan
  const cleaned = html.replace(/<(script|style|noscript|iframe|svg|nav|header|footer|aside|form|figure)[\s>][\s\S]*?<\/\1>/gi, ' ');
  const scopes = [...cleaned.matchAll(/<article[\s>][\s\S]*?<\/article>/gi)].map((m) => m[0]);
  const scope = scopes.sort((a, b) => b.length - a.length)[0] ?? cleaned;
  return [...scope.matchAll(/<p[\s>][\s\S]*?<\/p>/gi)].map((m) => stripTags(m[0]).replace(/\s+/g, ' '));
}

/** Tek parça gelen uzun metni ~3-4 cümlelik paragraflara böler (okunabilirlik için) */
function reflow(paragraph: string): string[] {
  if (paragraph.length <= 700) return [paragraph];
  const sentences = paragraph.match(/[^.!?…]+(?:[.!?…]+["”’)]*|$)\s*/g) ?? [paragraph];
  const out: string[] = [];
  let current = '';
  for (const sentence of sentences) {
    if (current && current.length + sentence.length > 450) {
      out.push(current.trim());
      current = '';
    }
    current += sentence;
  }
  if (current.trim()) out.push(current.trim());
  return out;
}

function clean(raw: string[], minLength: number): string[] {
  const seen = new Set<string>();
  const paragraphs: string[] = [];
  for (const paragraph of raw) {
    if (paragraph.length < minLength || FOOTER.test(paragraph) || (paragraph.length < 140 && BOILERPLATE.test(paragraph)) || seen.has(paragraph)) continue;
    seen.add(paragraph);
    paragraphs.push(...reflow(paragraph));
    if (paragraphs.length >= MAX_PARAGRAPHS) break;
  }
  return paragraphs.slice(0, MAX_PARAGRAPHS);
}

const wordCount = (paragraphs: string[]) => paragraphs.reduce((sum, p) => sum + p.split(/\s+/).length, 0);

export function extractArticle(html: string, url: string): Article {
  const fromJson = articleBodyFromJsonLd(html);
  const structured = fromJson ? clean(splitParagraphs(stripTags(fromJson.replaceAll('\r', ''))), 2) : [];
  const fromHtml = clean(paragraphsFromHtml(html), MIN_PARAGRAPH);
  // Yapısal veri daha temizdir; ama bazı siteler orada yalnızca özeti verir → sayfadaki metin belirgin uzunsa o
  const paragraphs = wordCount(structured) >= wordCount(fromHtml) * 0.8 ? structured : fromHtml;
  // Sondaki noktalama içermeyen kısa satırlar genellikle "ilgili haber" başlıklarıdır
  while (paragraphs.length > 1 && paragraphs.at(-1)!.length < 120 && !/[.!?…"”':]$/.test(paragraphs.at(-1)!)) paragraphs.pop();
  const titleTag = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1];
  return {
    title: meta(html, 'og:title') ?? (titleTag ? stripTags(titleTag) || null : null),
    image: safeHttpUrl(meta(html, 'og:image'), url),
    paragraphs,
  };
}

/** Haber sayfasını indirir ve metnini çıkarır. Boyut ve süre sınırlıdır. */
export const fetchArticle: ArticleFetcher = async (url) => {
  const response = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (Linux; Android 14) Clario/1.0', Accept: 'text/html,application/xhtml+xml' },
    signal: AbortSignal.timeout(TIMEOUT_MS),
    redirect: 'follow',
  });
  if (!response.ok) throw new Error(`${url} → ${response.status}`);
  const length = Number(response.headers.get('content-length') ?? 0);
  if (length > MAX_BYTES) throw new Error(`${url} çok büyük`);
  const html = await response.text();
  if (html.length > MAX_BYTES) throw new Error(`${url} çok büyük`);
  return extractArticle(html, url);
};
