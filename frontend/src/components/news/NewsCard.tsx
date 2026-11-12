import type { NewsItem } from '../../types'
import { timeAgo } from '../../utils/format'
import { openNews } from '../../utils/overlay'
import { Badge } from '../ui'
import { newsTone } from './tone'

/** Gündemdeki bir gelişme: başlık ve kaynak, olası etkisi (verinizle), önerilen aksiyon. Başlık okuyucuyu açar. */
export function NewsCard({ item, compact = false }: { item: NewsItem; compact?: boolean }) {
  const itemTone = newsTone(item)
  return (
    <article className={`news-card tone-${itemTone}${compact ? ' compact' : ''}`}>
      <div className="news-meta">
        <Badge tone={itemTone}>{item.themeLabel}</Badge>
        {item.relevance === 'high' && <Badge tone="risk">Önemli</Badge>}
        {item.mentions.map((m) => (
          <Badge key={m.label} tone="neutral">
            {m.label}
          </Badge>
        ))}
        <span className="faint">
          {item.source}
          {item.publishedAt && ` · ${timeAgo(item.publishedAt)}`}
        </span>
      </div>
      <div className="news-title">
        {/* Haber Clario içinde açılır (okuyucu); kaynağa gitmek okuyucudan isteğe bağlı */}
        <button type="button" className="news-open" onClick={() => openNews(item)}>
          {item.title}
        </button>
        {item.kind === 'fx' && <span className="faint"> ({item.summary})</span>}
      </div>
      <div className="news-effect">
        <b>Olası etki:</b> {item.effect}
        {!compact && item.details.map((d) => ` ${d}`).join('')}
      </div>
      {!compact && (
        <div className="news-action">
          <b>Öneri:</b> {item.action}
        </div>
      )}
    </article>
  )
}
