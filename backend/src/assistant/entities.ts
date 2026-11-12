import type { ProductRow, RegionRow } from '../repositories/catalogRepository.js';
import { normalizeText, tokenize } from './text.js';

export interface QuestionEntities {
  regions: RegionRow[];
  products: ProductRow[];
}

/** Ürün adındaki ayırt edici kelimeler ("El Dezenfektanı 1L" → ["dezenfektani"]). */
const MIN_WORD_LENGTH = 5;

function significantWords(name: string): string[] {
  return tokenize(normalizeText(name)).filter((w) => w.length >= MIN_WORD_LENGTH && !/\d/.test(w));
}

/**
 * Sorudaki bölge ve ürün adlarını yakalar. Türkçe ekler için önek eşleşmesi yapılır:
 * "Bursa'da" → "bursa", "dezenfektan satışı" → "El Dezenfektanı 1L".
 */
export function extractEntities(question: string, regions: RegionRow[], products: ProductRow[]): QuestionEntities {
  const tokens = tokenize(normalizeText(question));
  const hasPrefixMatch = (word: string) =>
    tokens.some((t) => t.startsWith(word) || (t.length >= MIN_WORD_LENGTH && word.startsWith(t)));

  return {
    regions: regions.filter((r) => tokens.some((t) => t.startsWith(normalizeText(r.name)))),
    products: products.filter(
      (p) => tokens.includes(normalizeText(p.sku).replace(' ', '')) || significantWords(p.name).some(hasPrefixMatch),
    ),
  };
}
