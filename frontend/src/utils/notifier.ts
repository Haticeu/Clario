import type { NewsFeed, ReportNotice } from '../types'
import { native } from './native'

/**
 * Canlı bildirimler: zil her yenilendiğinde yeni gelen önemli haberler ve rapor bildirimleri (ekstre, gün sonu)
 * sistem bildirimi olarak gösterilir. Telefonda Android bildirimi; bilgisayarda (izin verildiyse) tarayıcı
 * bildirimi, yalnızca Clario sekmesi arka plandayken. Aynı bildirim bir kez gösterilir.
 */

export interface SystemNotification {
  id: string
  title: string
  body: string
  /** Bildirime dokununca açılacak sayfa */
  path: string
}

const STORAGE_KEY = 'clario-notified'
const MAX_REMEMBERED = 300

function remembered(): Set<string> | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? new Set(JSON.parse(raw) as string[]) : null
  } catch {
    return new Set()
  }
}

function remember(ids: Set<string>) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([...ids].slice(-MAX_REMEMBERED)))
  } catch {
    // Depolama kapalıysa bildirimler yine çalışır; yalnızca tekrar gösterilebilir
  }
}

export function noticePath(n: ReportNotice): string {
  const q = n.query
  if (q.kind === 'monthly') return `/reports?view=statements&kind=monthly&month=${q.month}`
  if (q.kind === 'daily') return `/reports?view=statements&kind=daily&date=${q.date}`
  return `/receivables?tab=${q.tab}`
}

function candidates(feed: NewsFeed): SystemNotification[] {
  const reports = (feed.notices ?? []).map((n) => ({ id: n.id, title: n.title, body: n.body, path: noticePath(n) }))
  const news = feed.items
    .filter((i) => i.relevance === 'high' || (i.relevance === 'medium' && i.kind === 'fx'))
    .map((i) => ({ id: `news-${i.id}`, title: i.title, body: `Olası etki: ${i.effect}`, path: `/?news=${encodeURIComponent(i.id)}` }))
  return [...reports, ...news]
}

function showWeb(n: SystemNotification) {
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted' || !document.hidden) return
  const notification = new Notification(n.title, { body: n.body, icon: '/icon-192.png', tag: n.id })
  notification.onclick = () => {
    window.focus()
    window.history.pushState({}, '', n.path)
    window.dispatchEvent(new PopStateEvent('popstate'))
    notification.close()
  }
}

/** Zil verisi her geldiğinde çağrılır. İlk çalışmada mevcutlar sessizce "gösterildi" sayılır (eski bildirim yağmuru olmaz). */
export function notifyNew(feed: NewsFeed): void {
  const seen = remembered()
  const all = candidates(feed)
  if (seen === null) {
    remember(new Set(all.map((n) => n.id)))
    return
  }
  const fresh = all.filter((n) => !seen.has(n.id))
  if (fresh.length === 0) return
  for (const n of fresh) seen.add(n.id)
  remember(seen)
  const bridge = native()
  // En fazla 3 bildirim; fazlası zilde
  for (const n of fresh.slice(0, 3)) {
    if (bridge?.notify) void bridge.notify(n)
    else showWeb(n)
  }
}

/** Bilgisayarda tarayıcı bildirim izni (Ayarlar'dan istenir) */
export function webNotificationState(): 'granted' | 'denied' | 'default' | 'unsupported' {
  if (native()) return 'granted'
  return typeof Notification === 'undefined' ? 'unsupported' : Notification.permission
}

export async function requestWebNotifications(): Promise<boolean> {
  if (typeof Notification === 'undefined') return false
  return (await Notification.requestPermission()) === 'granted'
}
