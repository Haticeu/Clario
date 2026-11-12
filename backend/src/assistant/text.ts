const TURKISH_FOLD: Record<string, string> = {
  ç: 'c',
  ğ: 'g',
  ı: 'i',
  ö: 'o',
  ş: 's',
  ü: 'u',
  â: 'a',
  î: 'i',
  û: 'u',
};

/**
 * Karşılaştırma için metni sadeleştirir: Türkçe küçük harf, aksan katlama,
 * noktalama → boşluk. "Bursa'da satışlar NEDEN düştü?" → "bursa da satislar neden dustu"
 */
export function normalizeText(text: string): string {
  return text
    .toLocaleLowerCase('tr-TR')
    .replace(/[çğıöşüâîû]/g, (ch) => TURKISH_FOLD[ch] ?? ch)
    .replace(/[^a-z0-9%\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function tokenize(normalized: string): string[] {
  return normalized.split(' ').filter(Boolean);
}
