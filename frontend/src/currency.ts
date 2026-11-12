import { createContext, use } from 'react'
import type { CurrencyOption } from './types'

export const CURRENCY_STORAGE_KEY = 'clario-currency'

/** Backend'e ulaşılamazsa kullanılan liste (backend/src/currency/currencies.ts ile aynı) */
export const FALLBACK_CURRENCIES: CurrencyOption[] = [
  { code: 'TRY', label: 'Türk lirası', symbol: '₺' },
  { code: 'USD', label: 'ABD doları', symbol: '$' },
  { code: 'EUR', label: 'Euro', symbol: '€' },
  { code: 'GBP', label: 'İngiliz sterlini', symbol: '£' },
]

export interface CurrencyContextValue {
  /** Verilerin girildiği para birimi (veri girişi ekranları bununla çalışır) */
  base: string
  /** Analizlerin gösterildiği para birimi */
  display: string
  currencies: CurrencyOption[]
  setDisplay: (code: string) => void
  /** Ana para birimini kaydeder; mevcut tutarlar çevrilmez */
  setBase: (code: string) => Promise<void>
}

export const CurrencyContext = createContext<CurrencyContextValue | null>(null)

export function useCurrency(): CurrencyContextValue {
  const value = use(CurrencyContext)
  if (!value) throw new Error('useCurrency, CurrencyProvider içinde kullanılmalı')
  return value
}

export const currencySymbol = (currencies: CurrencyOption[], code: string) =>
  currencies.find((c) => c.code === code)?.symbol ?? code
