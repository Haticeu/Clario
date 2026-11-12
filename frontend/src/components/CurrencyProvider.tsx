import { useCallback, useEffect, useLayoutEffect, useMemo, useState, type ReactNode } from 'react'
import { getSettings, isAbortError, saveBaseCurrency, setRequestCurrency } from '../api'
import { CURRENCY_STORAGE_KEY, CurrencyContext, FALLBACK_CURRENCIES } from '../currency'
import type { AppSettings } from '../types'
import { notifyDataChanged } from '../utils/dataEvents'
import { setDisplayCurrency } from '../utils/format'
import { LoadingState } from './states'

function readStored(): string | null {
  try {
    return localStorage.getItem(CURRENCY_STORAGE_KEY)
  } catch {
    return null
  }
}

/**
 * Para birimi: veriler ana para biriminde saklanır, analizler seçilen gösterim para biriminde
 * (her kayıt kendi tarihindeki kurla çevrilerek) gelir. Seçim tarayıcıda hatırlanır.
 */
export function CurrencyProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<AppSettings | null>(null)
  const [unavailable, setUnavailable] = useState(false)
  const [chosen, setChosen] = useState<string | null>(readStored)

  useEffect(() => {
    const controller = new AbortController()
    getSettings(controller.signal)
      .then(setSettings)
      .catch((error: unknown) => {
        // Backend kapalıysa sayfalar kendi hata durumlarını gösterir; varsayılan TRY ile devam
        if (!isAbortError(error)) setUnavailable(true)
      })
    return () => controller.abort()
  }, [])

  const base = settings?.baseCurrency ?? 'TRY'
  const currencies = settings?.currencies ?? FALLBACK_CURRENCIES
  const display = chosen && currencies.some((c) => c.code === chosen) ? chosen : base

  // Sayfaların veri istekleri (useEffect) bundan sonra çalışır; hepsi yeni para birimiyle gider.
  useLayoutEffect(() => {
    setDisplayCurrency(display)
    setRequestCurrency(display)
  }, [display])

  const setDisplay = useCallback((code: string) => {
    setChosen(code)
    try {
      localStorage.setItem(CURRENCY_STORAGE_KEY, code)
    } catch {
      // Depolama kapalıysa seçim yalnızca bu oturumda geçerli
    }
  }, [])

  const setBase = useCallback(async (code: string) => {
    const saved = await saveBaseCurrency(code)
    setSettings((current) => (current ? { ...current, baseCurrency: saved.baseCurrency } : current))
    notifyDataChanged()
  }, [])

  const value = useMemo(() => ({ base, display, currencies, setDisplay, setBase }), [base, display, currencies, setDisplay, setBase])

  if (!settings && !unavailable) return <LoadingState label="Clario açılıyor…" />
  return <CurrencyContext value={value}>{children}</CurrencyContext>
}
