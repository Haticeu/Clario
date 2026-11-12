import { useSyncExternalStore } from 'react'

/** CSS medya sorgusu eşleşiyor mu (ekran boyutu değişince güncellenir) */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (listener) => {
      const list = window.matchMedia(query)
      list.addEventListener('change', listener)
      return () => list.removeEventListener('change', listener)
    },
    () => window.matchMedia(query).matches,
  )
}

/** Telefon ve dar ekran yerleşimi: üst menü çubuğu (kenar çubuğu yerine) */
export const MOBILE_QUERY = '(max-width: 960px)'
