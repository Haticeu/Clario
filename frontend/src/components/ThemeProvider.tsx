import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { CHART_PALETTES, THEME_STORAGE_KEY, ThemeContext, type ThemeMode } from '../theme'

function readInitialMode(): ThemeMode {
  // index.html'deki satır içi script temayı React'ten önce uygular; aynı değerden başla.
  return document.documentElement.dataset.theme === 'light' ? 'light' : 'dark'
}

/** Koyu tema varsayılandır; seçim tarayıcıda hatırlanır. */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const [mode, setMode] = useState<ThemeMode>(readInitialMode)

  useEffect(() => {
    document.documentElement.dataset.theme = mode
    try {
      localStorage.setItem(THEME_STORAGE_KEY, mode)
    } catch {
      // Gizli sekme vb. durumlarda depolama kapalı olabilir; tema yine de çalışır.
    }
  }, [mode])

  const toggle = useCallback(() => setMode((m) => (m === 'dark' ? 'light' : 'dark')), [])
  const value = useMemo(() => ({ mode, chart: CHART_PALETTES[mode], toggle, setMode }), [mode, toggle])

  return <ThemeContext value={value}>{children}</ThemeContext>
}
