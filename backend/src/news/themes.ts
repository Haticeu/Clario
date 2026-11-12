import { normalizeText, tokenize } from '../assistant/text.js';

/**
 * Haber başlıklarını ekonomik temalara ayıran kural tabanlı sınıflandırıcı (yapay zekâ yok).
 * Her anahtar kelimenin ağırlığı vardır; bir temanın seçilmesi için toplam puan eşiği geçmelidir.
 * Kurallar asistandaki gibidir: "faiz" → kelime öneki, "=fed" → tam kelime, "baz puan" → ifade.
 */

export type ThemeId =
  | 'interest'
  | 'currency'
  | 'inflation'
  | 'energy'
  | 'commodities'
  | 'supply'
  | 'demand'
  | 'wages'
  | 'tax'
  | 'trade'
  | 'disaster'
  | 'growth';

export type Direction = 'up' | 'down' | null;

type Rule = [term: string, weight: number];

interface ThemeDefinition {
  id: ThemeId;
  label: string;
  tr: Rule[];
  en: Rule[];
  /** Bu ifadeler geçiyorsa tema seçilmez (ör. "savaş gemileri" bir tören haberidir, savaş değil) */
  exclude?: { tr: string[]; en: string[] };
  /** Yön yalnızca fiyat bildiren bir kelimeyle birlikteyse sayılır ("yenilenebilirin payı arttı" maliyet artışı değildir) */
  priceBound?: boolean;
}

export const THEMES: readonly ThemeDefinition[] = [
  {
    id: 'interest',
    label: 'Faiz',
    tr: [['faiz', 3], ['politika faizi', 2], ['merkez bankasi', 2], ['=ppk', 3], ['=fed', 3], ['=ecb', 3], ['baz puan', 2]],
    en: [['interest rate', 3], ['rate hike', 3], ['rate cut', 3], ['=fed', 3], ['central bank', 3], ['=ecb', 3], ['bank of england', 3], ['basis points', 2]],
  },
  {
    id: 'currency',
    label: 'Döviz kuru',
    // "dolar" tek başına eşiğin altında: "5 milyar dolar ihracat" gibi tutarlarda da geçer; yön kelimesiyle eşiği geçer
    tr: [['doviz', 3], ['=kur', 3], ['=kuru', 3], ['=kurlar', 3], ['dolar tl', 3], ['euro tl', 3], ['parite', 2], ['deger kaybet', 2], ['deger kazan', 2], ['dolar', 2], ['=euro', 2], ['sterlin', 2]],
    en: [['exchange rate', 3], ['forex', 3], ['currency', 2], ['dollar', 2], ['=euro', 2], ['sterling', 2], ['=yen', 2]],
  },
  {
    id: 'inflation',
    label: 'Enflasyon',
    tr: [['enflasyon', 3], ['=tufe', 3], ['=ufe', 3], ['hayat pahaliligi', 3], ['fiyat artis', 2]],
    en: [['inflation', 3], ['=cpi', 3], ['consumer prices', 3], ['cost of living', 3]],
  },
  {
    id: 'energy',
    label: 'Enerji ve akaryakıt',
    tr: [['petrol', 3], ['brent', 3], ['akaryakit', 3], ['benzin', 3], ['motorin', 3], ['dogalgaz', 3], ['dogal gaz', 3], ['elektrik', 2], ['enerji', 2]],
    en: [['=oil', 3], ['brent', 3], ['crude', 3], ['gas prices', 3], ['petrol', 3], ['energy', 2], ['electricity', 2]],
    priceBound: true,
  },
  {
    id: 'commodities',
    label: 'Hammadde',
    tr: [['emtia', 3], ['hammadde', 3], ['celik', 2], ['bakir', 2], ['aluminyum', 2], ['pamuk', 2], ['bugday', 2], ['plastik', 2]],
    en: [['commodit', 3], ['raw material', 3], ['steel', 2], ['copper', 2], ['aluminium', 2], ['wheat', 2], ['cotton', 2]],
    priceBound: true,
  },
  {
    id: 'supply',
    label: 'Tedarik ve lojistik',
    tr: [['tedarik zinciri', 3], ['navlun', 3], ['konteyner', 2], ['=grev', 3], ['limani', 2], ['lojistik', 2], ['nakliye', 2]],
    en: [['supply chain', 3], ['freight', 3], ['shipping', 2], ['=strike', 2], ['=port', 2], ['logistics', 2]],
  },
  {
    id: 'demand',
    label: 'Tüketici talebi',
    tr: [['perakende satis', 3], ['tuketici guven', 3], ['kartli harcama', 3], ['tuketim', 2], ['harcama', 2]],
    en: [['retail sales', 3], ['consumer confidence', 3], ['consumer spending', 3], ['=demand', 1]],
  },
  {
    id: 'wages',
    label: 'Ücretler',
    tr: [['asgari ucret', 4], ['memur zammi', 3], ['maas', 2], ['=ucret', 2], ['ucretler', 2]],
    en: [['minimum wage', 4], ['=wages', 2], ['=wage', 2]],
  },
  {
    id: 'tax',
    label: 'Vergi ve düzenleme',
    tr: [['=kdv', 3], ['=otv', 3], ['vergi', 2], ['yeni duzenleme', 2]],
    en: [['=tax', 2], ['=vat', 3], ['regulation', 2]],
  },
  {
    id: 'trade',
    label: 'Dış ticaret',
    tr: [['ihracat', 3], ['ithalat', 3], ['gumruk', 2], ['tarife', 2], ['dis ticaret', 3]],
    en: [['tariff', 3], ['=trade', 2], ['export', 3], ['import', 3]],
  },
  {
    id: 'disaster',
    label: 'Kriz ve afet',
    tr: [['deprem', 3], ['=sel', 3], ['=selde', 3], ['yangin', 2], ['afet', 3], ['savas', 3], ['catisma', 2], ['kriz', 2], ['resesyon', 3], ['salgin', 3]],
    en: [['earthquake', 3], ['flood', 3], ['=war', 3], ['conflict', 2], ['crisis', 2], ['recession', 3], ['pandemic', 3], ['wildfire', 3]],
    exclude: {
      tr: ['savas gemi', 'savas ucag', 'kortej', 'tatbikat', '=dask', 'sigorta', 'anma', 'yildonum', 'odeme yapt'],
      en: ['warship', 'anniversary', 'memorial', 'insurance payout'],
    },
  },
  {
    id: 'growth',
    label: 'Büyüme ve istihdam',
    tr: [['buyume', 2], ['gsyh', 3], ['milli gelir', 3], ['issizlik', 3]],
    en: [['=gdp', 3], ['unemployment', 3], ['growth', 1]],
  },
];

/** Fiyat bildiren kelimeler (priceBound temalarında yönün geçerli sayılması için) */
const PRICE_WORDS: Record<'tr' | 'en', string[]> = {
  tr: ['fiyat', '=zam', 'zamm', 'varil', 'litre', 'maliyet', 'tarife'],
  en: ['price', 'prices', 'barrel', 'cost', 'costs', 'tariff'],
};

/** Tedarikte aksama bildiren kelimeler: tedarik temasında yalnızca bunlar varsa "aksama" (up) sayılır */
const DISRUPTION_WORDS: Record<'tr' | 'en', string[]> = {
  tr: ['aksa', 'kesinti', 'gecik', '=grev', 'grevi', 'kapan', 'tikan', 'kitlik', 'durdu'],
  en: ['disruption', 'delay', 'delays', 'strike', 'shortage', 'halt', 'blocked', 'closure'],
};

const UP: Record<'tr' | 'en', string[]> = {
  tr: ['art', 'yuksel', 'zam', 'rekor', 'sicra', 'tirman', 'sikilas', 'pahalan', 'deger kaybet'],
  en: ['rise', 'rises', 'rose', 'raise', 'raised', 'hike', 'increase', 'surge', 'soar', 'jump', 'higher', 'record', 'climb'],
};
const DOWN: Record<'tr' | 'en', string[]> = {
  tr: ['dus', 'indir', 'geril', 'azal', 'ucuzla', 'gevs', 'deger kazan'],
  en: ['cut', 'cuts', 'fall', 'falls', 'fell', 'drop', 'decline', 'lower', 'ease', 'eases', 'slump', 'plunge', 'slow', 'sink'],
};

/** Bir temanın seçilmesi için gereken en düşük puan */
const MIN_SCORE = 3;

function matches(term: string, text: string, tokens: string[]): boolean {
  if (term.startsWith('=')) return tokens.includes(term.slice(1));
  if (term.includes(' ')) return ` ${text} `.includes(` ${term}`);
  return tokens.some((token) => token.startsWith(term));
}

function direction(text: string, tokens: string[], language: 'tr' | 'en'): Direction {
  const up = UP[language].some((term) => matches(term, text, tokens));
  const down = DOWN[language].some((term) => matches(term, text, tokens));
  return up === down ? null : up ? 'up' : 'down';
}

export interface Classification {
  theme: ThemeId;
  label: string;
  direction: Direction;
  score: number;
}

/** Başlık (ve özet) en çok hangi temaya uyuyor? Hiçbirine yeterince uymuyorsa null. */
export function classify(title: string, summary: string, language: 'tr' | 'en'): Classification | null {
  // Başlık belirleyicidir; özet yalnızca yarım ağırlıkla katkı verir
  const titleText = normalizeText(title);
  const titleTokens = tokenize(titleText);
  const summaryText = normalizeText(summary);
  const summaryTokens = tokenize(summaryText);
  const rawDirection = direction(titleText, titleTokens, language);
  const mentionsPrice = PRICE_WORDS[language].some((term) => matches(term, titleText, titleTokens));

  let best: Classification | null = null;
  for (const theme of THEMES) {
    if (theme.exclude?.[language].some((term) => matches(term, titleText, titleTokens) || matches(term, summaryText, summaryTokens))) continue;
    const dir =
      theme.id === 'supply'
        ? DISRUPTION_WORDS[language].some((term) => matches(term, titleText, titleTokens)) ? 'up' : null
        : theme.priceBound && !mentionsPrice
          ? null
          : rawDirection;
    let score = 0;
    for (const [term, weight] of theme[language]) {
      if (matches(term, titleText, titleTokens)) score += weight;
      else if (matches(term, summaryText, summaryTokens)) score += weight / 2;
    }
    if (score > 0 && dir) score += 1;
    if (score >= MIN_SCORE && (!best || score > best.score)) best = { theme: theme.id, label: theme.label, direction: dir, score };
  }
  return best;
}

export const themeLabel = (id: ThemeId) => THEMES.find((t) => t.id === id)!.label;
