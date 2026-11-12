import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { getMe, logout, onUnauthorized, toApiError, type ApiError } from '../../api'
import { AuthContext } from '../../auth'
import { useSplashDone } from '../../hooks/useSplashDone'
import type { Me } from '../../types'
import { CurrencyProvider } from '../CurrencyProvider'
import { ErrorState } from '../states'
import { AuthScreen } from './AuthScreen'
import { Onboarding } from './Onboarding'
import { SplashScreen } from './SplashScreen'

type State = { kind: 'loading' } | { kind: 'anonymous' } | { kind: 'error'; error: ApiError } | { kind: 'ready'; me: Me }

const ready = (me: Me): State => ({ kind: 'ready', me })
const failed = (err: unknown): State => {
  const error = toApiError(err)
  return error.status === 401 ? { kind: 'anonymous' } : { kind: 'error', error }
}

/**
 * Uygulamanın girişi: açılış ekranı → (oturum yoksa) giriş/kayıt → (ilk girişse) kurulum → uygulama.
 * Oturum düşerse (süre doldu, başka cihazda parola değişti) giriş ekranına dönülür.
 */
export function AuthGate({ children }: { children: ReactNode }) {
  const [state, setState] = useState<State>({ kind: 'loading' })
  const splashDone = useSplashDone()

  const load = useCallback(() => getMe().then(ready, failed).then(setState), [])

  useEffect(() => {
    let active = true
    getMe()
      .then(ready, failed)
      .then((next) => active && setState(next))
    return () => {
      active = false
    }
  }, [])

  useEffect(() => onUnauthorized(() => setState({ kind: 'anonymous' })), [])

  const signOut = useCallback(async () => {
    try {
      await logout()
    } finally {
      setState({ kind: 'anonymous' })
    }
  }, [])

  const me = state.kind === 'ready' ? state.me : null
  const value = useMemo(() => (me ? { me, refresh: load, signOut } : null), [me, load, signOut])

  if (state.kind === 'loading' || !splashDone) return <SplashScreen />
  if (state.kind === 'error') {
    return (
      <div className="onboarding">
        <div className="onboarding-card panel">
          <ErrorState error={state.error} onRetry={() => void load()} />
        </div>
      </div>
    )
  }
  if (state.kind === 'anonymous' || !value) return <AuthScreen onAuthenticated={() => void load()} />

  return (
    <AuthContext value={value}>
      {/* Hesap değişince para birimi ve tüm sayfalar sıfırdan kurulur (önceki hesabın verisi bellekte kalmaz) */}
      <CurrencyProvider key={value.me.email ?? ''}>{value.me.onboardingCompleted ? children : <Onboarding />}</CurrencyProvider>
    </AuthContext>
  )
}
