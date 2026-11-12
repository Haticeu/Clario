import { buildAnalysisContext, getAnalysisContext, NoDataError } from '../analysis/context.js';
import type { InsightBase } from '../analysis/types.js';
import type { DbClient } from '../db/types.js';
import { getProducts, getRegions } from '../repositories/catalogRepository.js';
import { todayIso } from '../utils/dates.js';
import { extractEntities } from './entities.js';
import { HANDLERS, scopeNote, type AssistantServices } from './handlers.js';
import { resolveIntent, type IntentId } from './intents.js';
import { buildStatement, localDate } from '../analysis/statement.js';
import { parseStatementRequest, type StatementRequest } from './statementRequest.js';
import { customerProfile, findCustomer } from './customerProfile.js';
import { normalizeText } from './text.js';

const GREETING = /^(merhaba|selam|selamlar|gunaydin|iyi gunler|iyi aksamlar|hey|tesekkur|tesekkurler|sagol|sagolun|nasilsin)( |$)/;
/** Müşteri adı geçtiğinde profile yönlendirilen genel niyetler */
const CUSTOMER_INTENTS = new Set<IntentId>(['summary', 'churn', 'sales_change', 'top_sellers', 'profit', 'receivables']);

export const EXAMPLE_QUESTIONS = [
  'Bu ay neden satışlar düştü?',
  'Hangi müşterileri kaybediyoruz?',
  'Hangi ürün zarar ettiriyor?',
  'Fazla stoğu olan ürünler hangileri?',
  "Bursa'da hangi fırsatlar var?",
  'Piyasa durumu risklerimi nasıl etkiler?',
  'Öncelikle ne yapmalıyım?',
  'Genel durum nasıl?',
  'Geçen ayın ekstresini istiyorum',
];

export interface AssistantResponse {
  question: string;
  asOf: string;
  intent: IntentId | 'statement' | 'customer' | 'greeting' | 'unknown';
  intentLabel: string;
  confidence: number;
  /** Niyeti belirleyen anahtar kelimeler (cevabın neden bu analize yönlendiğini gösterir). */
  matchedKeywords: string[];
  entities: { regions: string[]; products: string[] };
  answer: string;
  items: InsightBase[];
  data: unknown;
  /** Güncel haberlere dayanan cevaplarda kaynaklar */
  sources: { title: string; url: string }[];
  suggestions: string[];
}

/**
 * Serbest metin soruyu anahtar kelime/niyet eşlemesiyle bir analiz fonksiyonuna yönlendirir,
 * analizi veritabanı üzerinde çalıştırır ve sonucu okunabilir bir cevaba dönüştürür.
 * Genel amaçlı bir sohbet botu değildir: her cevap gerçek verinin analizinden gelir.
 */
/** Gündem soruları satış verisi gerektirmez: veri yoksa bugünü referans alır. Diğer sorular veri ister (503). */
async function contextFor(db: DbClient, intent: IntentId | undefined) {
  try {
    return await getAnalysisContext(db);
  } catch (error) {
    if (error instanceof NoDataError && intent === 'market') return buildAnalysisContext(todayIso());
    throw error;
  }
}

/** Rapor/ekstre isteği: özeti yazar, indirme seçeneklerini (data.statement) döner */
async function statementAnswer(db: DbClient, question: string, request: StatementRequest, today: string): Promise<AssistantResponse> {
  const statement = await buildStatement(db, request.kind, request.period);
  const formatNames = { excel: 'Excel', pdf: 'PDF', word: 'Word' } as const;
  const lines = [
    `${statement.title} hazır.`,
    ...statement.highlights.slice(0, 5).map((h) => `• ${h}`),
    `Aşağıdan ${request.formats.map((f) => formatNames[f]).join(', ')} olarak indirebilir veya Raporlar'da açabilirsiniz.`,
  ];
  return {
    question,
    asOf: today,
    intent: 'statement',
    intentLabel: request.kind === 'monthly' ? 'Aylık ekstre' : request.kind === 'daily' ? 'Gün sonu raporu' : 'Dönem raporu',
    confidence: 1,
    matchedKeywords: [],
    entities: { regions: [], products: [] },
    answer: lines.join('\n'),
    items: [],
    data: { statement: { kind: request.kind, query: request.query, title: statement.title, formats: request.formats, period: statement.period } },
    sources: [],
    suggestions: ['Geçen ayın ekstresi', 'Dünün gün sonu raporu', 'Son 7 günün raporu'].filter((q) => q !== question),
  };
}

export async function askAssistant(
  db: DbClient,
  question: string,
  services: AssistantServices = { news: null },
): Promise<AssistantResponse> {
  // "Eylül raporunu istiyorum", "dünün gün sonu raporu", "son 7 günün özeti pdf"
  const today = localDate(new Date());
  const statementRequest = parseStatementRequest(question, today);
  if (statementRequest) return statementAnswer(db, question, statementRequest, today);

  const { match, confidence } = resolveIntent(question);

  // Selamlaşma / teşekkür: veri gerektirmez
  if (!match && GREETING.test(normalizeText(question))) {
    return {
      question,
      asOf: today,
      intent: 'greeting',
      intentLabel: 'Sohbet',
      confidence: 1,
      matchedKeywords: [],
      entities: { regions: [], products: [] },
      answer: /tesekkur|sagol/.test(normalizeText(question))
        ? 'Rica ederim! Başka bir konuda yardımcı olabilirim: satış, stok, müşteriler, riskler veya rapor/ekstre isteyebilirsiniz.'
        : 'Merhaba! Ben Clario. İşletmenizin verisiyle ilgili sorularınızı yanıtlarım: satışlar, stok, müşteriler (ör. bir müşterinin adını yazın), riskler, öneriler, piyasa gündemi; "Eylül ekstresi" gibi rapor da isteyebilirsiniz.',
      items: [],
      data: null,
      sources: [],
      suggestions: EXAMPLE_QUESTIONS.slice(0, 4),
    };
  }

  const [ctx, regions, products, customers] = await Promise.all([
    contextFor(db, match?.intent.id),
    getRegions(db),
    getProducts(db),
    db.query<{ id: number; name: string }>('SELECT id, name FROM customers'),
  ]);
  const entities = extractEntities(question, regions, products);
  const entityNames = { regions: entities.regions.map((r) => r.name), products: entities.products.map((p) => p.name) };

  // Müşteri adı geçiyorsa (ve soru başka bir analize açıkça yönelmiyorsa) müşteri profili
  const customer = findCustomer(question, customers);
  if (customer && (!match || CUSTOMER_INTENTS.has(match.intent.id))) {
    const profile = await customerProfile(db, ctx, customer);
    return {
      question,
      asOf: ctx.asOf,
      intent: 'customer',
      intentLabel: 'Müşteri profili',
      confidence: 1,
      matchedKeywords: [customer.name],
      entities: entityNames,
      answer: profile.lines.join('\n'),
      items: [],
      data: profile.data,
      sources: [],
      suggestions: ['Hangi müşterileri kaybediyoruz?', 'Geçen ayın ekstresini istiyorum'],
    };
  }

  if (!match) {
    return {
      question,
      asOf: ctx.asOf,
      intent: 'unknown',
      intentLabel: 'Anlaşılamadı',
      confidence: 0,
      matchedKeywords: [],
      entities: entityNames,
      answer:
        'Bu soruyu bir analize eşleyemedim. Satış, stok, müşteri kaybı, risk, fırsat, marj, ' +
        'gider, öneriler veya güncel piyasa durumu hakkında sorabilirsiniz.',
      items: [],
      data: null,
      sources: [],
      suggestions: EXAMPLE_QUESTIONS.slice(0, 4),
    };
  }

  const result = await HANDLERS[match.intent.id](db, ctx, entities, question, services);
  const note = scopeNote(entities);

  return {
    question,
    asOf: ctx.asOf,
    intent: match.intent.id,
    intentLabel: match.intent.label,
    confidence,
    matchedKeywords: match.matchedKeywords,
    entities: entityNames,
    answer: [...(note ? [note] : []), ...result.lines].join('\n'),
    items: result.items,
    data: result.data ?? null,
    sources: result.sources ?? [],
    suggestions: EXAMPLE_QUESTIONS.filter((q) => resolveIntent(q).match?.intent.id !== match.intent.id).slice(0, 3),
  };
}
