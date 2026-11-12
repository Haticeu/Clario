import { apiGetBinary, API_BASE_URL } from '../api/client'
import { native, type SavedFile } from './native'
import { showToast } from './toast'

function anchorDownload(href: string, filename: string): void {
  const link = document.createElement('a')
  link.href = href
  link.download = filename
  link.click()
}

/** Telefonda kaydedildiyse konumu ve Aç / Paylaş seçenekleri gösterilir */
function announce(file: SavedFile | void) {
  if (file) showToast(`Kaydedildi: ${file.location}`, file)
}

/** Tarayıcıda oluşturulan bir dosyayı (ör. rapor, kurtarma anahtarı) indirir; telefonda Belgeler/Clario'ya kaydeder */
export async function saveBlob(blob: Blob, filename: string): Promise<void> {
  const bridge = native()
  if (bridge) return announce(await bridge.saveFile(new Uint8Array(await blob.arrayBuffer()), filename, blob.type || 'application/octet-stream'))
  const url = URL.createObjectURL(blob)
  anchorDownload(url, filename)
  URL.revokeObjectURL(url)
}

/** API'den dosya indirir (Excel şablonu, veri dökümü). Web'de doğrudan bağlantı; telefonda uygulama içi köprü. */
export async function downloadApiFile(path: string, filename: string, mimeType: string): Promise<void> {
  const bridge = native()
  if (!bridge) return anchorDownload(`${API_BASE_URL}${path}`, filename)
  const data = await apiGetBinary(path)
  announce(await bridge.saveFile(new Uint8Array(data), filename, mimeType))
}
