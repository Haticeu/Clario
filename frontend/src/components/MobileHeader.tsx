import { useEffect, useRef, useState } from 'react'
import { Link, NavLink, useLocation } from 'react-router'
import { useAuth } from '../auth'
import { NAV_ITEMS } from '../navigation'
import { MenuIcon, CloseIcon, SettingsIcon } from './icons'
import { NotificationBell } from './news/NotificationBell'
import { GlobalSearch } from './search/GlobalSearch'

/**
 * Telefon ve dar ekranlarda üstte sabit duran menü çubuğu: solda Clario, sağda arama, bildirimler ve menü.
 * Sayfalar menü simgesinin altında açılan listede; para birimi ve çıkış Ayarlar'da.
 */
export function MobileHeader() {
  const { me } = useAuth()
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  const { pathname } = useLocation()

  // Sayfa değişince menü kapanır
  const [lastPath, setLastPath] = useState(pathname)
  if (lastPath !== pathname) {
    setLastPath(pathname)
    setOpen(false)
  }

  // Dışarı dokununca veya Esc ile kapanır
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

  return (
    <header className="mobile-header">
      <Link to="/" className="mobile-brand" aria-label="Clario ana sayfa">
        <img src="/icon-192.png" alt="" width={30} height={30} />
        <span>Clario</span>
      </Link>
      <div className="mobile-actions">
        <GlobalSearch />
        <NotificationBell />
        <div className="mobile-menu" ref={root}>
          <button
            type="button"
            className="bell-button"
            aria-label={open ? 'Menüyü kapat' : 'Menü'}
            aria-expanded={open}
            onClick={() => setOpen((v) => !v)}
            {...(open ? { 'data-back-close': true } : {})}
          >
            {open ? <CloseIcon size={20} /> : <MenuIcon size={22} />}
          </button>
          {open && (
            <nav className="mobile-menu-panel" aria-label="Modüller">
              {NAV_ITEMS.map(({ to, label, icon: ItemIcon }) => (
                <NavLink key={to} to={to} end={to === '/'} className="nav-link">
                  <ItemIcon size={18} />
                  <span>{label}</span>
                </NavLink>
              ))}
              <div className="mobile-menu-divider" />
              <NavLink to="/settings" className="nav-link">
                <SettingsIcon size={18} />
                <span className="mobile-menu-settings">
                  Ayarlar
                  <small>{me.name || me.email}</small>
                </span>
              </NavLink>
            </nav>
          )}
        </div>
      </div>
    </header>
  )
}
