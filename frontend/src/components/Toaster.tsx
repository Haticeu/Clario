import { native } from '../utils/native'
import { dismissToast, useToast } from '../utils/toast'
import { CloseIcon } from './icons'

/** Alttaki kısa bildirim; telefonda kaydedilen dosya için Aç / Paylaş */
export function Toaster() {
  const toast = useToast()
  if (!toast) return null
  const bridge = native()
  const file = toast.file
  return (
    <div className="toast" role="status" key={toast.id}>
      <span className="toast-message">{toast.message}</span>
      {file && bridge?.openFile && (
        <button type="button" className="toast-action" onClick={() => void bridge.openFile!(file).catch(() => undefined)}>
          Aç
        </button>
      )}
      {file && bridge?.shareFile && (
        <button type="button" className="toast-action" onClick={() => void bridge.shareFile!(file).catch(() => undefined)}>
          Paylaş
        </button>
      )}
      <button type="button" className="toast-close" onClick={dismissToast} aria-label="Kapat">
        <CloseIcon size={15} />
      </button>
    </div>
  )
}
