import { useSyncExternalStore } from 'react'
import type { NewsItem } from '../types'

/**
 * Sayfanın üstünde açılan tam ekran görünümler (haber okuyucu, işlem ayrıntısı). Uygulamanın her yerinden
 * açılabilir; tek seferde bir tane gösterilir ve geri tuşu / Esc ile kapanır.
 */
export type Overlay = { kind: 'news'; item: NewsItem } | { kind: 'order'; id: number } | { kind: 'ledger'; customerId: number }

let current: Overlay | null = null
const listeners = new Set<() => void>()

function set(next: Overlay | null) {
  current = next
  for (const listener of listeners) listener()
}

export const openNews = (item: NewsItem) => set({ kind: 'news', item })
export const openOrder = (id: number) => set({ kind: 'order', id })
export const openLedger = (customerId: number) => set({ kind: 'ledger', customerId })
export const closeOverlay = () => set(null)

export function useOverlay(): Overlay | null {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    () => current,
  )
}
