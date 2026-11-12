import { normalizeText, tokenize } from './text.js';

export type IntentId =
  | 'sales_change'
  | 'top_sellers'
  | 'churn'
  | 'risks'
  | 'opportunities'
  | 'inventory'
  | 'margin'
  | 'profit'
  | 'recommendations'
  | 'summary'
  | 'market'
  | 'segments'
  | 'receivables';

/**
 * Anahtar kelime eşleme kuralları (normalize edilmiş, aksansız biçimde):
 *  - "satis"      → kelime öneki: satış, satışlar, satışı…
 *  - "=kar"       → tam kelime (karar, kargo gibi yanlış eşleşmeleri önler)
 *  - "en cok satan" → ifade (boşluk içeren terimler metin içinde aranır)
 */
interface KeywordRule {
  term: string;
  weight: number;
}

export interface IntentDefinition {
  id: IntentId;
  label: string;
  keywords: KeywordRule[];
}

const k = (term: string, weight: number): KeywordRule => ({ term, weight });

export const INTENTS: readonly IntentDefinition[] = [
  {
    id: 'sales_change',
    label: 'Satış / ciro değişimi analizi',
    keywords: [k('satis', 2), k('ciro', 2.5), k('gelir', 2), k('dus', 1.5), k('azal', 1.5), k('gerile', 1.5), k('neden', 1), k('degis', 1), k('bu ay', 0.5)],
  },
  {
    id: 'top_sellers',
    label: 'En çok satan ürünler',
    keywords: [k('en cok satan', 4), k('en fazla satan', 4), k('cok satan', 3), k('en iyi', 2), k('populer', 2), k('lider', 1.5)],
  },
  {
    id: 'churn',
    label: 'Müşteri kaybı (churn) analizi',
    // Ünsüz yumuşaması: kayıp → kaybı/kaybediyoruz ("kayb" öneki)
    keywords: [k('kayb', 3), k('kayip', 1.5), k('kayip risk', 2), k('churn', 3), k('sessiz', 2.5), k('siparis vermeyen', 3), k('gelmeyen', 2), k('terk', 2), k('musteri', 1.5), k('bayi', 1)],
  },
  {
    id: 'risks',
    label: 'Risk tespiti',
    keywords: [k('risk', 3), k('tehlike', 2), k('sorun', 2), k('problem', 2), k('uyari', 1.5), k('kritik', 1.5), k('endise', 1.5)],
  },
  {
    id: 'opportunities',
    label: 'Fırsat tespiti',
    keywords: [k('firsat', 3), k('buyu', 2), k('artan', 2), k('artis', 1.5), k('yukselen', 2), k('potansiyel', 2), k('transfer', 2), k('aktar', 2)],
  },
  {
    id: 'inventory',
    label: 'Stok analizi',
    // Ünsüz yumuşaması: stok → stoğu/stoğa ("stog" öneki)
    keywords: [k('stok', 3), k('stog', 3), k('envanter', 3), k('depo', 2), k('tuken', 2.5), k('elde kalan', 2), k('yeter', 1)],
  },
  {
    id: 'margin',
    label: 'Ürün marj analizi',
    keywords: [k('marj', 3), k('zarar ettir', 3.5), k('en az kazandir', 3.5), k('dusuk kar', 3), k('karlilik', 2), k('maliyet', 1.5), k('kazandir', 1.5), k('zarar', 1.5), k('urun', 0.5)],
  },
  {
    id: 'profit',
    label: 'Kârlılık ve gider özeti',
    keywords: [k('gider', 3), k('masraf', 3), k('net kar', 3), k('brut kar', 3), k('=kar', 2.5), k('=kari', 2.5), k('=karimiz', 2.5), k('=karli', 2), k('kazanc', 2), k('zarar ediyor', 3)],
  },
  {
    id: 'recommendations',
    label: 'Önceliklendirilmiş öneriler',
    keywords: [k('oneri', 3), k('tavsiye', 3), k('aksiyon', 3), k('ne yapmali', 3), k('ne yapmam', 3), k('ne yapalim', 3), k('oncelik', 2), k('yapmaliyim', 3), k('yapmaliyiz', 3)],
  },
  {
    id: 'summary',
    label: 'Genel durum özeti',
    keywords: [k('ozet', 3), k('genel durum', 3), k('nasil gidiyor', 3), k('son durum', 3), k('kpi', 3), k('dashboard', 2), k('durum', 1)],
  },
  {
    id: 'segments',
    label: 'Departman ve proje analizi',
    keywords: [k('departman', 3.5), k('proje', 3.5), k('bolum', 1.5), k('masraf merkezi', 3), k('is bazli', 3)],
  },
  {
    id: 'receivables',
    label: 'Cari hesap: alacak ve borç',
    keywords: [
      k('alacak', 3.5), k('tahsil', 3), k('vadesi gec', 3.5), k('vadesi gelen', 3), k('=vade', 2), k('=vadeli', 2), k('borc', 2.5),
      k('bakiye', 3), k('=cari', 2.5), k('odeme bekle', 3), k('odenecek', 3), k('odememiz', 3), k('tedarikci', 2), k('nakit', 2.5),
      k('dso', 3), k('kredi limit', 3), k('kimden', 1.5), k('kime', 1),
    ],
  },
  {
    id: 'market',
    label: 'Güncel piyasa ve haber etkisi',
    // Dış etkenler: kendi verisiyle değil güncel haberlerle cevaplanır (bkz. news/service.ts).
    // "kur" tam kelime olarak aranır; önek olsaydı "kurum", "kurye" gibi kelimeler eşleşirdi.
    keywords: [
      k('piyasa', 3.5), k('haber', 3.5), k('gundem', 3.5), k('ekonomi', 3), k('enflasyon', 3), k('faiz', 3),
      k('doviz', 3), k('=kur', 3), k('=kuru', 3), k('=kurlar', 3), k('=kurdaki', 3), k('dolar', 2.5), k('euro', 2.5),
      k('emtia', 3), k('hammadde', 2.5), k('akaryakit', 2.5), k('resesyon', 3), k('kriz', 2), k('makro', 3),
      k('dis etken', 3), k('guncel', 1.5), k('dunya', 1.5), k('sektor', 1.5), k('global', 1.5),
    ],
  },
];

/** Bir niyetin seçilmesi için gereken minimum puan. */
export const MIN_INTENT_SCORE = 2;

export interface IntentMatch {
  intent: IntentDefinition;
  score: number;
  matchedKeywords: string[];
}

function matches(term: string, text: string, tokens: string[]): boolean {
  if (term.startsWith('=')) return tokens.includes(term.slice(1));
  if (term.includes(' ')) return ` ${text} `.includes(` ${term}`);
  return tokens.some((token) => token.startsWith(term));
}

/** Soruyu tüm niyetlere karşı puanlar; en yüksek puandan düşüğe sıralı döner. */
export function scoreIntents(question: string): IntentMatch[] {
  const text = normalizeText(question);
  const tokens = tokenize(text);

  return INTENTS.map((intent) => {
    const matched = intent.keywords.filter((rule) => matches(rule.term, text, tokens));
    return {
      intent,
      score: matched.reduce((total, rule) => total + rule.weight, 0),
      matchedKeywords: matched.map((rule) => rule.term.replace(/^=/, '')),
    };
  }).sort((a, b) => b.score - a.score);
}

export interface IntentResolution {
  match: IntentMatch | null;
  /** 0–1: en iyi niyetin ikinciye göre ne kadar baskın olduğu. */
  confidence: number;
}

export function resolveIntent(question: string): IntentResolution {
  const [best, second] = scoreIntents(question);
  if (!best || best.score < MIN_INTENT_SCORE) return { match: null, confidence: 0 };
  const confidence = best.score / (best.score + (second?.score ?? 0));
  return { match: best, confidence: Math.round(confidence * 100) / 100 };
}
