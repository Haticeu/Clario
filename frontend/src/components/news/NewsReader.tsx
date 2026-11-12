import { getNewsArticle } from '../../api'
import { useApi } from '../../hooks/useApi'
import type { NewsItem } from '../../types'
import { timeAgo } from '../../utils/format'
import { openExternal } from '../../utils/native'
import { ExternalIcon } from '../icons'
import { Sheet } from '../overlay/Sheet'
import { Badge } from '../ui'
import { newsTone } from './tone'

/**
 * Haberi Clario içinde okuma: önce Clario'nun yorumu (verinize olası etkisi ve öneri), altında haberin metni.
 * Metin kaynaktan okuma modunda alınır; alınamazsa özet gösterilir. Kaynağa gitmek isteğe bağlıdır.
 */
export function NewsReader({ item, onClose }: { item: NewsItem; onClose: () => void }) {
  const article = useApi((signal) => (item.kind === 'news' ? getNewsArticle(item.id, signal) : Promise.resolve(null)))
  const tone = newsTone(item)
  const paragraphs = article.data?.paragraphs ?? []
  const loading = item.kind === 'news' && article.loading && !article.data

  return (
    <Sheet
      title={item.source}
      onClose={onClose}
      footer={
        item.url && (
          <button type="button" className="button" onClick={() => openExternal(item.url!)}>
            <ExternalIcon size={16} /> {item.source} sitesinde aç
          </button>
        )
      }
    >
      <article className="reader">
        <div className="news-meta">
          <Badge tone={tone}>{item.themeLabel}</Badge>
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
        <h1 className="reader-title">{item.title}</h1>

        <section className={`reader-insight tone-${tone}`} aria-label="Clario yorumu">
          <div className="reader-insight-label">Clario yorumu · işletmenize olası etkisi</div>
          <p>
            <b>Olası etki:</b> {item.effect}
            {item.details.map((d) => ` ${d}`).join('')}
          </p>
          <p>
            <b>Öneri:</b> {item.action}
          </p>
        </section>

        {article.data?.image && <img className="reader-image" src={article.data.image} alt="" loading="lazy" referrerPolicy="no-referrer" />}

        {loading && (
          <div className="reader-skeleton" aria-label="Haber yükleniyor">
            <span />
            <span />
            <span />
            <span />
          </div>
        )}
        {!loading && paragraphs.length > 0 && (
          <div className="reader-text">
            {paragraphs.map((p, i) => (
              <p key={i}>{p}</p>
            ))}
          </div>
        )}
        {!loading && paragraphs.length === 0 && (
          <div className="reader-text">
            {item.summary && <p>{item.summary}</p>}
            {item.kind === 'news' && (
              <p className="faint">
                {article.error ? 'Haber metnine şu an ulaşılamadı.' : 'Bu kaynak haberin tam metnini paylaşmıyor.'} Ayrıntılar için kaynağı açabilirsiniz.
              </p>
            )}
          </div>
        )}
        {item.url && paragraphs.length > 0 && <p className="reader-credit faint">Kaynak: {item.source}. Metin, okumayı kolaylaştırmak için sadeleştirilmiştir.</p>}
      </article>
    </Sheet>
  )
}
