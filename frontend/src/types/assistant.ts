import type { AnyInsight } from './insights'

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
  | 'receivables'
  | 'statement'
  | 'customer'
  | 'greeting'
  | 'unknown'

export interface AssistantResponse {
  question: string
  asOf: string
  intent: IntentId
  intentLabel: string
  /** 0–1 */
  confidence: number
  matchedKeywords: string[]
  entities: { regions: string[]; products: string[] }
  /** Satır sonlarıyla ayrılmış cevap metni */
  answer: string
  items: AnyInsight[]
  data: unknown
  /** Güncel haberlere dayanan cevaplarda kaynaklar */
  sources: SourceLink[]
  suggestions: string[]
}

export interface AssistantExamples {
  examples: string[]
}

export interface SourceLink {
  title: string
  url: string
}
