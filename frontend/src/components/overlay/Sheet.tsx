import { useEffect, useRef, type ReactNode } from 'react'
import { BackIcon, CloseIcon } from '../icons'

/**
 * Sayfanın üstünde açılan okuma görünümü: telefonda tam ekran, geniş ekranda ortada panel.
 * Esc, arka plana tıklama veya Android geri tuşu (data-back-close) ile kapanır; açıkken sayfa kaymaz.
 */
export function Sheet({ title, onClose, children, footer }: { title: string; onClose: () => void; children: ReactNode; footer?: ReactNode }) {
  const panel = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    const overflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const previous = document.activeElement as HTMLElement | null
    panel.current?.focus()
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = overflow
      previous?.focus?.()
    }
  }, [onClose])

  return (
    <div className="sheet-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="sheet" role="dialog" aria-modal="true" aria-label={title} tabIndex={-1} ref={panel}>
        <div className="sheet-bar">
          <button type="button" className="sheet-back" onClick={onClose} data-back-close>
            <BackIcon size={20} /> Geri
          </button>
          <span className="sheet-title">{title}</span>
          <button type="button" className="sheet-close" onClick={onClose} aria-label="Kapat">
            <CloseIcon size={18} />
          </button>
        </div>
        <div className="sheet-body">{children}</div>
        {footer && <div className="sheet-footer">{footer}</div>}
      </div>
    </div>
  )
}
