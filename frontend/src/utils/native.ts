/**
 * Android uygulamasının (bkz. mobile/src/main.ts) sağladığı yerel işlevler. Tarayıcıda yoktur; her çağıran
 * web karşılığına düşer.
 */
/** Telefonda kaydedilen dosya (Belgeler/Clario) */
export interface SavedFile {
  location: string
  uri: string
  mimeType: string
}

export interface NativeBridge {
  /** Dosyayı Belgeler/Clario klasörüne kaydeder (olmazsa paylaş menüsü açılır ve undefined döner) */
  saveFile(data: Uint8Array, filename: string, mimeType: string): Promise<SavedFile | void>
  /** Kaydedilen dosyayı uygun uygulamada açar (PDF görüntüleyici, Excel, Word…) */
  openFile?(file: SavedFile): Promise<void>
  /** Kaydedilen dosyayı paylaşır (WhatsApp, e-posta, Drive…) */
  shareFile?(file: SavedFile): Promise<void>
  /** Bağlantıyı uygulamanın içinde açar (üstte kapat düğmesiyle; kapatınca Clario'ya dönülür) */
  openUrl(url: string): Promise<void>
  /** Sistem bildirimi gösterir (dokununca path açılır) */
  notify?(notification: { id: string; title: string; body: string; path: string }): Promise<void>
  /** Uygulama kapalıyken de gelen tekrarlı hatırlatmalar: ayın 1'inde ekstre, her gün gün sonu raporu */
  scheduleReports?(settings: { monthly: boolean; daily: boolean; dailyHour: number }): Promise<void>
}

export const native = () => (globalThis as { __clarioNative?: NativeBridge }).__clarioNative

/** Haber kaynağı gibi dış bağlantılar: telefonda uygulama içi tarayıcıda, web'de yeni sekmede */
export function openExternal(url: string): void {
  const bridge = native()
  if (bridge) void bridge.openUrl(url)
  else window.open(url, '_blank', 'noopener,noreferrer')
}
