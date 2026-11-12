export type NewsTheme =
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
  | 'growth'

export type NewsRelevance = 'high' | 'medium' | 'low'

/** Gündemdeki bir gelişme ve işletmeye olası etkisi */
export interface NewsItem {
  id: string
  /** news: haber başlığı · fx: kur hareketinden üretilen sinyal */
  kind: 'news' | 'fx'
  theme: NewsTheme
  themeLabel: string
  /** up: artış/sıkılaşma · down: düşüş/gevşeme · null: yön belirsiz */
  direction: 'up' | 'down' | null
  title: string
  summary: string
  source: string
  url: string | null
  publishedAt: string | null
  relevance: NewsRelevance
  /** Haberde geçen bölge/kategori/ürün adlarınız */
  mentions: { label: string; kind: 'region' | 'category' | 'product' }[]
  effect: string
  details: string[]
  action: string
}

/** GET /api/news */
export interface NewsFeed {
  items: NewsItem[]
  /** Rapor bildirimleri: aylık ekstre, gün sonu raporu */
  notices: import('./statement').ReportNotice[]
  unread: number
  sources: { name: string; ok: boolean }[]
  updatedAt: string | null
}

/** /api/news/:id/article — haberin Clario içinde okunan metni (okuma modu) */
export interface NewsArticle {
  title: string | null
  image: string | null
  /** Boşsa metin alınamadı: yalnızca özet gösterilir */
  paragraphs: string[]
  url: string
  source: string
}
