import type { ComponentType } from 'react'
import {
  CustomersIcon,
  DashboardIcon,
  DatabaseIcon,
  InventoryIcon,
  RecommendationIcon,
  ReportIcon,
  RiskIcon,
  SalesIcon,
  SegmentsIcon,
  LedgerIcon,
} from './components/icons'

export interface NavItem {
  to: string
  label: string
  icon: ComponentType<{ size?: number }>
}

/** Sayfa modülleri; sidebar ve sekme başlıkları bu listeden üretilir. AI asistanı sayfa değil, her sayfadaki sohbet balonudur. */
export const NAV_ITEMS: NavItem[] = [
  { to: '/', label: 'Genel Bakış', icon: DashboardIcon },
  { to: '/reports', label: 'Raporlar', icon: ReportIcon },
  { to: '/receivables', label: 'Cari & Alacak', icon: LedgerIcon },
  { to: '/sales', label: 'Satış Analizi', icon: SalesIcon },
  { to: '/inventory', label: 'Stok Analizi', icon: InventoryIcon },
  { to: '/customers', label: 'Müşteri Analizi', icon: CustomersIcon },
  { to: '/risks', label: 'Risk Tespiti', icon: RiskIcon },
  { to: '/recommendations', label: 'Öneriler', icon: RecommendationIcon },
  { to: '/segments', label: 'Departman & Proje', icon: SegmentsIcon },
  { to: '/data', label: 'Veri Yönetimi', icon: DatabaseIcon },
]
