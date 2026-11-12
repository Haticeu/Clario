import { createContext, use } from 'react'
import type { Me } from './types'

export interface AuthContextValue {
  me: Me
  /** Profili (ve kurulum durumunu) sunucudan yeniden okur */
  refresh: () => Promise<void>
  signOut: () => Promise<void>
}

export const AuthContext = createContext<AuthContextValue | null>(null)

export function useAuth(): AuthContextValue {
  const value = use(AuthContext)
  if (!value) throw new Error('useAuth, AuthGate içinde kullanılmalı')
  return value
}

/** Parola kuralı (backend/src/auth/service.ts ile aynı): en az N karakter, en az bir harf ve bir rakam */
export function passwordRules(password: string, minLength: number) {
  return [
    { ok: password.length >= minLength, label: `En az ${minLength} karakter` },
    { ok: /\p{L}/u.test(password) && /\d/.test(password), label: 'Harf ve rakam içeriyor' },
  ]
}
