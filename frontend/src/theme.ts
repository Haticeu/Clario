import { createContext, use } from 'react'

export type ThemeMode = 'dark' | 'light'

export const THEME_STORAGE_KEY = 'clario-theme'

/**
 * Grafik renkleri. Arayüz renkleri index.css'teki CSS değişkenlerinde; Recharts SVG
 * öznitelikleri CSS değişkeni okuyamadığı için grafik paleti burada JS olarak tutulur.
 * Nötr/karşılaştırma = mavi/gri, olumlu = yeşil, olumsuz = kırmızı.
 */
export const CHART_PALETTES = {
  dark: {
    grid: '#232b38',
    axis: '#7d879a',
    text: '#e6e9ef',
    tooltipBg: '#171d27',
    tooltipBorder: '#2b3444',
    current: '#4c8dff',
    previous: '#4a5363',
    positive: '#2fbf71',
    negative: '#f05252',
    segments: ['#4c8dff', '#9b87f5', '#5ec8d8'],
  },
  // Açık tema (sis mavisi): kutu rengi #dae1ea üzerinde okunacak tonlar
  light: {
    grid: '#bfc9d6',
    axis: '#56647a',
    text: '#122033',
    tooltipBg: '#e3e9f0',
    tooltipBorder: '#b4c0cf',
    current: '#245fc9',
    previous: '#93a1b5',
    positive: '#127a42',
    negative: '#c42b2b',
    segments: ['#245fc9', '#6d52d6', '#12879a'],
  },
} as const

export type ChartPalette = (typeof CHART_PALETTES)[ThemeMode]

export interface ThemeContextValue {
  mode: ThemeMode
  chart: ChartPalette
  toggle: () => void
  setMode: (mode: ThemeMode) => void
}

export const ThemeContext = createContext<ThemeContextValue | null>(null)

export function useTheme(): ThemeContextValue {
  const context = use(ThemeContext)
  if (!context) throw new Error('useTheme, ThemeProvider içinde kullanılmalı.')
  return context
}
