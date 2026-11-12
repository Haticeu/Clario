import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router'
import { getNews, markNewsSeen } from '../../api'
import { useApi } from '../../hooks/useApi'
import type { ReportNotice } from '../../types'
import { onDataChanged } from '../../utils/dataEvents'
import { noticePath, notifyNew } from '../../utils/notifier'
import { openNews } from '../../utils/overlay'
import { timeAgo } from '../../utils/format'
import { BellIcon, StatementIcon } from '../icons'
import { NewsCard } from './NewsCard'

/** Canlı: 5 dakikada bir ve uygulamaya geri dönüldüğünde yenilenir (kaynaklar sunucuda 10 dakika önbellekte) */
const REFRESH_MS = 5 * 60 * 1000
const MAX_ITEMS = 8

function NoticeCard({ notice, onOpen }: { notice: ReportNotice; onOpen: (path: string) => void }) {
  return (
    <button type="button" className="notice-card" onClick={() => onOpen(noticePath(notice))}>
      <span className="notice-icon" aria-hidden="true">
        <StatementIcon size={18} />
      </span>
      <span className="notice-text">
        <b>{notice.title}</b>
        <span>{notice.body}</span>
        <span className="faint">{timeAgo(notice.availableAt)}</span>
      </span>
    </button>
  )
}

/**
 * Sağ üstteki bildirim zili: rapor bildirimleri (aylık ekstre, gün sonu raporu) ve işletmeyi etkileyebilecek
 * gündem başlıkları, okunmamış sayısı. Açılınca bildirimler okundu sayılır. Yeni gelenler sistem bildirimi olur.
 */
export function NotificationBell() {
  const news = useApi(getNews)
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const { reload, data } = news

  useEffect(() => {
    const timer = setInterval(reload, REFRESH_MS)
    // Uygulamaya / sekmeye dönünce hemen yenile
    const onVisible = () => {
      if (!document.hidden) reload()
    }
    document.addEventListener('visibilitychange', onVisible)
    // Veri eklenince/içe aktarılınca rapor bildirimleri (ekstre, gün sonu) hemen güncellenir
    const offData = onDataChanged(reload)
    return () => {
      clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisible)
      offData()
    }
  }, [reload])

  // Yeni önemli haberler ve raporlar: sistem bildirimi
  useEffect(() => {
    if (data) notifyNew(data)
  }, [data])

  // Bildirime dokunarak gelindiyse (?news=…) haberi Clario içinde aç
  const newsParam = params.get('news')
  useEffect(() => {
    if (!newsParam || !data) return
    const item = data.items.find((i) => i.id === newsParam)
    if (item) openNews(item)
    const next = new URLSearchParams(params)
    next.delete('news')
    setParams(next, { replace: true })
  }, [newsParam, data, params, setParams])

  // Dışarı tıklayınca veya Esc ile kapanır
  useEffect(() => {
    if (!open) return
    const onClick = (event: MouseEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false)
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onClick)
    window.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onClick)
      window.removeEventListener('keydown', onKey)
    }
  }, [open])

  async function toggle() {
    const next = !open
    setOpen(next)
    if (next && (data?.unread ?? 0) > 0) {
      await markNewsSeen().catch(() => undefined)
      reload()
    }
  }

  function openPath(path: string) {
    setOpen(false)
    navigate(path)
  }

  const unread = data?.unread ?? 0
  const notices = data?.notices ?? []
  const items = (data?.items ?? []).filter((item) => item.relevance !== 'low').slice(0, MAX_ITEMS)
  const unreachable = data && !data.sources.some((s) => s.ok)

  return (
    <div className="bell" ref={root}>
      <button
        type="button"
        className="bell-button"
        onClick={() => void toggle()}
        aria-expanded={open}
        aria-label={unread > 0 ? `Bildirimler: ${unread} yeni` : 'Bildirimler'}
        title="Bildirimler ve gündem"
      >
        <BellIcon size={20} />
        {unread > 0 && <span className="bell-badge">{unread > 9 ? '9+' : unread}</span>}
      </button>

      {open && (
        <div className="bell-panel" role="dialog" aria-label="Bildirimler ve gündem">
          <div className="bell-header">
            <b>Bildirimler</b>
            <span className="faint">Raporlarınız ve işletmenizi etkileyebilecek gelişmeler</span>
          </div>
          <div className="bell-list">
            {notices.map((notice) => (
              <NoticeCard key={notice.id} notice={notice} onOpen={openPath} />
            ))}
            {news.loading && !data && <div className="faint">Yükleniyor…</div>}
            {news.error && <div className="faint">{news.error.message}</div>}
            {unreachable && <div className="faint">Haber kaynaklarına ulaşılamadı; internet bağlantısını kontrol edin.</div>}
            {data && !unreachable && items.length === 0 && notices.length === 0 && (
              <div className="faint">Şu an yeni bir bildirim yok.</div>
            )}
            {items.map((item) => (
              <NewsCard key={item.id} item={item} compact />
            ))}
          </div>
          <div className="bell-footer">
            <Link to="/#gundem" onClick={() => setOpen(false)}>
              Tüm gündem Genel Bakış'ta →
            </Link>
            <Link to="/reports?view=statements" onClick={() => setOpen(false)}>
              Ekstre & İndir →
            </Link>
          </div>
        </div>
      )}
    </div>
  )
}
