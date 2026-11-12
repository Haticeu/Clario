import { useSyncExternalStore } from 'react'
import type { SavedFile } from './native'

/** Ekranın altında kısa süre görünen bilgi (ör. "Kaydedildi: Belgeler/Clario/…" + Aç / Paylaş) */
export interface Toast {
  id: number
  message: string
  file?: SavedFile
}

let current: Toast | null = null
let timer: ReturnType<typeof setTimeout> | undefined
const listeners = new Set<() => void>()
const emit = () => listeners.forEach((l) => l())

export function showToast(message: string, file?: SavedFile, ms = 7000): void {
  current = { id: Date.now(), message, file }
  clearTimeout(timer)
  timer = setTimeout(dismissToast, ms)
  emit()
}

export function dismissToast(): void {
  current = null
  emit()
}

export function useToast(): Toast | null {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => current,
  )
}
