import { useState } from 'react'
import { getNews } from '../../api'
import { useApi } from '../../hooks/useApi'
import { AsyncContent, EmptyState } from '../states'
import { Panel } from '../ui'
import { NewsCard } from './NewsCard'

const SHOWN = 4

/** Genel Bakış'taki gündem bölümü: önemli gelişmeler önce; diğerleri "tümünü göster" ile. */
export function NewsPanel() {
  const news = useApi(getNews)
  const [all, setAll] = useState(false)

  return (
    <Panel
      title="Gündem: işletmenizi etkileyebilecek gelişmeler"
      subtitle="Ekonomi haberleri ve döviz kurları, verinizle ilişkilendirilerek yorumlanır · olasılık belirtir, kesin tahmin değildir"
    >
      <div id="gundem" />
      <AsyncContent state={news} skeleton={<div className="skeleton" style={{ height: 140 }} />}>
        {(data) => {
          if (!data.sources.some((s) => s.ok) && data.items.length === 0) {
            return <EmptyState title="Haber kaynaklarına ulaşılamadı" description="İnternet bağlantısını kontrol edin; gündem birkaç dakikada bir yenilenir." />
          }
          const important = data.items.filter((item) => item.relevance !== 'low')
          const visible = all ? data.items : (important.length ? important : data.items).slice(0, SHOWN)
          if (visible.length === 0) return <EmptyState title="Şu an dikkat gerektiren bir gelişme yok" />
          return (
            <>
              <div className="news-list">
                {visible.map((item) => (
                  <NewsCard key={item.id} item={item} />
                ))}
              </div>
              <div className="form-actions" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
                <span className="faint" style={{ fontSize: 12 }}>
                  Kaynaklar: {data.sources.filter((s) => s.ok).map((s) => s.name).join(', ')}
                </span>
                {data.items.length > visible.length || all ? (
                  <button type="button" className="button button-small" onClick={() => setAll(!all)}>
                    {all ? 'Yalnızca önemlileri göster' : `Tümünü göster (${data.items.length})`}
                  </button>
                ) : null}
              </div>
            </>
          )
        }}
      </AsyncContent>
    </Panel>
  )
}
