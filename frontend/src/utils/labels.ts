import type { CoverageStatus, CustomerStatus, InsightKind, MarginStatus, Priority, RiskSignal, Severity } from '../types'

/** Arayüzde kullanılan renk tonları (index.css'teki .tone-* sınıfları). */
export type Tone = 'neutral' | 'accent' | 'risk' | 'opportunity' | 'churn' | 'warning' | 'muted'

export const SIGNAL_LABELS: Record<RiskSignal, string> = {
  sales_decline: 'Satış düşüşü',
  overstock: 'Fazla stok',
  stockout: 'Tükenme riski',
}

export const KIND_LABELS: Record<InsightKind, string> = {
  risk: 'Risk',
  opportunity: 'Fırsat',
  churn: 'Kayıp riski',
}

export const KIND_TONES: Record<InsightKind, Tone> = {
  risk: 'risk',
  opportunity: 'opportunity',
  churn: 'churn',
}

export const PRIORITY_LABELS: Record<Priority, string> = { high: 'Yüksek', medium: 'Orta', low: 'Düşük' }
export const PRIORITY_TONES: Record<Priority, Tone> = { high: 'risk', medium: 'warning', low: 'muted' }

export const SEVERITY_LABELS: Record<Severity, string> = { high: 'Yüksek önem', medium: 'Orta önem', low: 'Düşük önem' }

export const COVERAGE_LABELS: Record<CoverageStatus, string> = {
  stockout_risk: 'Tükenme riski',
  excess: 'Fazla stok',
  healthy: 'Sağlıklı',
  inactive: 'Hareketsiz',
  unknown: 'Stok bilgisi yok',
}
export const COVERAGE_TONES: Record<CoverageStatus, Tone> = {
  stockout_risk: 'risk',
  excess: 'warning',
  healthy: 'opportunity',
  inactive: 'muted',
  unknown: 'muted',
}

export const CUSTOMER_STATUS_LABELS: Record<CustomerStatus, string> = {
  active: 'Aktif',
  watch: 'İzlemede',
  churn_risk: 'Kayıp riski',
  insufficient_data: 'Yetersiz veri',
}
export const CUSTOMER_STATUS_TONES: Record<CustomerStatus, Tone> = {
  active: 'opportunity',
  watch: 'warning',
  churn_risk: 'risk',
  insufficient_data: 'muted',
}

export const MARGIN_STATUS_LABELS: Record<MarginStatus, string> = { loss: 'Zarar', low: 'Düşük marj', healthy: 'Sağlıklı' }
export const MARGIN_STATUS_TONES: Record<MarginStatus, Tone> = { loss: 'risk', low: 'warning', healthy: 'opportunity' }
