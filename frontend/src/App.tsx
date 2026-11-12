import { lazy, Suspense, useEffect } from 'react'
import { Link, Route, Routes, useLocation } from 'react-router'
import { AssistantWidget } from './components/AssistantWidget'
import { NotificationBell } from './components/news/NotificationBell'
import { OverlayHost } from './components/overlay/OverlayHost'
import { GlobalSearch } from './components/search/GlobalSearch'
import { MobileHeader } from './components/MobileHeader'
import { Sidebar } from './components/Sidebar'
import { MOBILE_QUERY, useMediaQuery } from './hooks/useMediaQuery'
import { getReportSettings } from './api'
import { native } from './utils/native'
import { useCurrency } from './currency'
import { EmptyState, LoadingState } from './components/states'
import { NAV_ITEMS } from './navigation'

// Her sayfa ayrı bir parça olarak, ilk açıldığında yüklenir (grafik kütüphanesi dahil).
const DashboardPage = lazy(() => import('./pages/DashboardPage'))
const SalesPage = lazy(() => import('./pages/SalesPage'))
const InventoryPage = lazy(() => import('./pages/InventoryPage'))
const CustomersPage = lazy(() => import('./pages/CustomersPage'))
const RisksPage = lazy(() => import('./pages/RisksPage'))
const RecommendationsPage = lazy(() => import('./pages/RecommendationsPage'))
const SegmentsPage = lazy(() => import('./pages/SegmentsPage'))
const ReportsPage = lazy(() => import('./pages/ReportsPage'))
const StatementsPage = lazy(() => import('./pages/StatementsPage'))
const ReceivablesPage = lazy(() => import('./pages/ReceivablesPage'))
const DataPage = lazy(() => import('./pages/DataPage'))
const SettingsPage = lazy(() => import('./pages/SettingsPage'))

/** Telefonda: ekstre ve gün sonu hatırlatmalarını ayarlara göre kur (uygulama kapalıyken de gelir) */
function useReportReminders() {
  useEffect(() => {
    const bridge = native()
    if (!bridge?.scheduleReports) return
    getReportSettings()
      .then((settings) => bridge.scheduleReports?.(settings))
      .catch(() => undefined)
  }, [])
}

/** Sayfa değişince sekme başlığını güncelle ve en üste kaydır. */
function useRouteEffects() {
  const { pathname } = useLocation()
  useEffect(() => {
    const item = NAV_ITEMS.find((i) => i.to === pathname)
    document.title = item ? `${item.label} · Clario` : 'Clario'
    window.scrollTo({ top: 0 })
  }, [pathname])
}

function NotFoundPage() {
  return (
    <EmptyState
      title="Sayfa bulunamadı"
      description={
        <>
          Aradığınız sayfa yok. <Link to="/">Genel Bakış'a dönün</Link>.
        </>
      }
    />
  )
}

export default function App() {
  useRouteEffects()
  useReportReminders()
  // Para birimi değişince sayfalar yeniden kurulur ve veriyi yeni para biriminde çeker
  const { base, display } = useCurrency()
  // Telefonda kenar çubuğu yerine üstte sabit menü çubuğu (arama ve zil de orada)
  const mobile = useMediaQuery(MOBILE_QUERY)

  return (
    <div className="app">
      {mobile ? <MobileHeader /> : <Sidebar />}
      <main className="main">
        {!mobile && (
          <div className="topbar">
            <GlobalSearch />
            <NotificationBell />
          </div>
        )}
        <OverlayHost />
        <Suspense fallback={<LoadingState label="Sayfa yükleniyor…" />}>
          <Routes key={`${base}-${display}`}>
          <Route path="/" element={<DashboardPage />} />
          <Route path="/sales" element={<SalesPage />} />
          <Route path="/inventory" element={<InventoryPage />} />
          <Route path="/customers" element={<CustomersPage />} />
          <Route path="/risks" element={<RisksPage />} />
          <Route path="/recommendations" element={<RecommendationsPage />} />
          <Route path="/segments" element={<SegmentsPage />} />
          <Route path="/reports" element={<ReportsPage />} />
          <Route path="/statements" element={<StatementsPage />} />
          <Route path="/receivables" element={<ReceivablesPage />} />
          <Route path="/data" element={<DataPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="*" element={<NotFoundPage />} />
          </Routes>
        </Suspense>
      </main>
      <AssistantWidget />
    </div>
  )
}
