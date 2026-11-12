import { useEffect } from 'react'
import { Link, NavLink } from 'react-router'
import { getHealth } from '../api'
import { useApi } from '../hooks/useApi'
import { useAuth } from '../auth'
import { onDataChanged } from '../utils/dataEvents'
import { formatDate } from '../utils/format'
import { NAV_ITEMS } from '../navigation'
import { SettingsIcon } from './icons'

export function Sidebar() {
  const { me } = useAuth()
  const health = useApi(getHealth)
  const { reload } = health
  useEffect(() => onDataChanged(reload), [reload])

  return (
    <aside className="sidebar">
      <NavLink to="/" className="brand" aria-label="Clario ana sayfa">
        <img className="brand-mark" src="/icon-192.png" alt="" width={34} height={34} />
        <span className="brand-text">
          <span className="brand-name">Clario</span>
          <br />
          <span className="brand-tagline">Veriden karara</span>
        </span>
      </NavLink>

      <nav className="nav" aria-label="Modüller">
        {NAV_ITEMS.map(({ to, label, icon: ItemIcon }) => (
          <NavLink key={to} to={to} end={to === '/'} className="nav-link" title={label}>
            <ItemIcon size={18} />
            <span className="nav-label">{label}</span>
          </NavLink>
        ))}
      </nav>

      <div className="sidebar-footer">
        {health.data &&
          (health.data.dataAsOf ? (
            <div className="data-date">Veri tarihi: {formatDate(health.data.dataAsOf)}</div>
          ) : (
            <div className="data-date">Henüz veri yok</div>
          ))}
        {health.error && <div className="data-date" style={{ color: 'var(--risk)' }}>API bağlantısı yok</div>}
        {/* Para birimi ve çıkış Ayarlar'da */}
        <div className="user-menu">
          <Link to="/settings" className="icon-button" title="Ayarlar">
            <SettingsIcon size={16} />
            <span className="nav-label user-email">{me.name || me.email}</span>
          </Link>
        </div>
      </div>
    </aside>
  )
}
