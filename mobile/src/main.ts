// Clario Android uygulamasının girişi. Sıra önemli: önce Node.js globalleri ve depolama, sonra cihazdaki backend,
// en son bilgisayardaki sürümle aynı React arayüzü.
import './globals'
import { App } from '@capacitor/app'
import { Browser } from '@capacitor/browser'
import { Capacitor } from '@capacitor/core'
import { Directory, Filesystem } from '@capacitor/filesystem'
import { LocalNotifications } from '@capacitor/local-notifications'
import { Share } from '@capacitor/share'
import { FileOpener } from '@capacitor-community/file-opener'
import { Buffer } from 'buffer'
import { flushNow, hydrate } from './shims/fs'
import { initSqlite } from './shims/sqlite'

/** Kaydedilen dosya: konumu kullanıcıya gösterilir, Aç / Paylaş için uri saklanır */
interface SavedFile {
  /** Kullanıcıya gösterilecek konum: "Belgeler/Clario/…" */
  location: string
  uri: string
  mimeType: string
}

/** Android 9 ve öncesinde ortak klasöre yazmak için izin gerekir (10+ için gerekmez) */
async function storageAllowed(): Promise<boolean> {
  try {
    let { publicStorage } = await Filesystem.checkPermissions()
    if (publicStorage === 'prompt' || publicStorage === 'prompt-with-rationale') publicStorage = (await Filesystem.requestPermissions()).publicStorage
    return publicStorage === 'granted'
  } catch {
    return true
  }
}

/**
 * Dosyayı (ekstre, rapor, Excel şablonu, kurtarma anahtarı) telefonun Belgeler/Clario klasörüne kaydeder.
 * Ortak klasöre yazılamazsa (izin reddi, eski cihaz) uygulama klasörüne kaydedip paylaş menüsünü açar.
 */
async function saveFile(data: Uint8Array, filename: string, mimeType: string): Promise<SavedFile | void> {
  if (!Capacitor.isNativePlatform()) {
    const url = URL.createObjectURL(new Blob([data], { type: mimeType }))
    const link = document.createElement('a')
    link.href = url
    link.download = filename
    link.click()
    URL.revokeObjectURL(url)
    return
  }
  const base64 = Buffer.from(data).toString('base64')
  if (await storageAllowed()) {
    try {
      const { uri } = await Filesystem.writeFile({ path: `Clario/${filename}`, data: base64, directory: Directory.Documents, recursive: true })
      return { location: `Belgeler/Clario/${filename}`, uri, mimeType }
    } catch (error) {
      console.warn('[clario] Belgeler klasörüne yazılamadı, paylaşıma düşülüyor:', error)
    }
  }
  const { uri } = await Filesystem.writeFile({ path: filename, data: base64, directory: Directory.Cache })
  await Share.share({ title: filename, files: [uri] })
}

async function openFile(file: SavedFile): Promise<void> {
  await FileOpener.open({ filePath: file.uri, contentType: file.mimeType, openWithDefault: true })
}

async function shareFile(file: SavedFile): Promise<void> {
  await Share.share({ title: file.location.split('/').pop(), files: [file.uri] })
}

/**
 * Haber kaynağı gibi dış bağlantılar uygulamanın içinde açılır (Chrome Custom Tabs: üstte kapat düğmesi,
 * kapatınca Clario'ya dönülür). Telefonun tarayıcısına geçilmez.
 */
async function openUrl(url: string): Promise<void> {
  if (!/^https?:\/\//i.test(url)) return
  if (!Capacitor.isNativePlatform()) {
    window.open(url, '_blank', 'noopener,noreferrer')
    return
  }
  const dark = document.documentElement.dataset.theme !== 'light'
  await Browser.open({ url, toolbarColor: dark ? '#0d1117' : '#ffffff', presentationStyle: 'popover' })
}

/**
 * Android geri tuşu: açık bir görünüm (haber okuyucu, işlem, arama) varsa onu kapatır; yoksa önceki sayfaya
 * döner; ilk sayfadaysa uygulamayı arka plana alır (kapatmaz: oturum ve veriler bellekte kalır).
 */
function handleBackButton(): void {
  void App.addListener('backButton', ({ canGoBack }) => {
    const closers = document.querySelectorAll<HTMLElement>('[data-back-close]')
    const last = closers[closers.length - 1]
    if (last) last.click()
    else if (canGoBack && window.history.length > 1) window.history.back()
    else void App.minimizeApp()
  })
}

/** Uygulama içinde sayfaya git (React Router geçmişi dinler) */
function navigate(path: string): void {
  if (!path.startsWith('/')) return
  window.history.pushState({}, '', path)
  window.dispatchEvent(new PopStateEvent('popstate'))
}

const MONTHLY_ID = 9001
const DAILY_ID = 9002

/** Bildirim izni (Android 13+ sistem penceresi bir kez sorulur) */
async function notificationsAllowed(): Promise<boolean> {
  if (!Capacitor.isNativePlatform()) return false
  let { display } = await LocalNotifications.checkPermissions()
  if (display === 'prompt' || display === 'prompt-with-rationale') display = (await LocalNotifications.requestPermissions()).display
  return display === 'granted'
}

/** Metin kimliğinden sabit sayısal bildirim kimliği (aynı bildirim iki kez gösterilmez) */
function numericId(id: string): number {
  let hash = 0
  for (let i = 0; i < id.length; i++) hash = (Math.imul(31, hash) + id.charCodeAt(i)) | 0
  return 10_000 + (Math.abs(hash) % 2_000_000_000)
}

/** Canlı bildirim: yeni önemli haber, hazır ekstre veya gün sonu raporu */
async function notify(n: { id: string; title: string; body: string; path: string }): Promise<void> {
  if (!(await notificationsAllowed())) return
  await LocalNotifications.schedule({
    notifications: [{ id: numericId(n.id), title: n.title, body: n.body, largeBody: n.body, extra: { path: n.path }, smallIcon: 'ic_stat_clario' }],
  })
}

/**
 * Tekrarlı hatırlatmalar: veriler şifreli olduğu ve uygulama kapalıyken açılamadığı için içerik genel bir metindir;
 * dokununca ilgili rapor açılır ve tutarlar orada hesaplanır.
 */
async function scheduleReports(settings: { monthly: boolean; daily: boolean; dailyHour: number }): Promise<void> {
  if (!Capacitor.isNativePlatform()) return
  await LocalNotifications.cancel({ notifications: [{ id: MONTHLY_ID }, { id: DAILY_ID }] })
  if (!settings.monthly && !settings.daily) return
  if (!(await notificationsAllowed())) return
  const notifications = []
  if (settings.monthly) {
    notifications.push({
      id: MONTHLY_ID,
      title: 'Aylık ekstreniz hazır',
      body: 'Geçen ayın ekstresini görüntüleyip Excel olarak indirebilirsiniz.',
      schedule: { on: { day: 1, hour: 9, minute: 0 }, allowWhileIdle: true },
      extra: { path: '/reports?view=statements&kind=monthly' },
      smallIcon: 'ic_stat_clario',
    })
  }
  if (settings.daily) {
    notifications.push({
      id: DAILY_ID,
      title: 'Gün sonu raporu',
      body: 'Bugünkü işlemlerinizin özeti hazır; PDF veya Word olarak indirebilirsiniz.',
      schedule: { on: { hour: settings.dailyHour, minute: 0 }, allowWhileIdle: true },
      extra: { path: '/reports?view=statements&kind=daily' },
      smallIcon: 'ic_stat_clario',
    })
  }
  await LocalNotifications.schedule({ notifications })
}

async function boot(): Promise<void> {
  await Promise.all([initSqlite(), hydrate()])
  const { startBackend } = await import('./backend')
  const { adapter } = await startBackend()
  const g = globalThis as Record<string, unknown>
  g.__clarioAdapter = adapter
  g.__clarioNative = { saveFile, openFile, shareFile, openUrl, notify, scheduleReports }

  // Uygulama arka plana alınınca bekleyen yazımlar hemen cihaza kaydedilir
  if (Capacitor.isNativePlatform()) {
    void App.addListener('pause', () => void flushNow())
    handleBackButton()
    // Bildirime dokununca ilgili sayfa açılır
    void LocalNotifications.addListener('localNotificationActionPerformed', ({ notification }) => {
      const path = (notification.extra as { path?: string } | undefined)?.path
      if (path) setTimeout(() => navigate(path), 300)
    })
  }
  window.addEventListener('pagehide', () => void flushNow())

  await import('../../frontend/src/main.tsx')
}

boot().catch((error: unknown) => {
  console.error('[clario] Açılış başarısız:', error)
  document.body.innerHTML = `<div style="font-family:system-ui;padding:24px;color:#e6e9ef;background:#0d1117;min-height:100vh">
    <h2>Clario açılamadı</h2><p>${String((error as Error)?.message ?? error).replace(/</g, '&lt;')}</p></div>`
})
