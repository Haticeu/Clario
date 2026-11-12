import { useCallback, useEffect, useEffectEvent, useState } from 'react'
import { ApiError, isAbortError, toApiError } from '../api'

export interface ApiState<T> {
  data: T | null
  error: ApiError | null
  loading: boolean
  reload: () => void
}

interface Result<T> {
  /** Bu sonucun ait olduğu deneme; güncel denemeden farklıysa istek hâlâ sürüyor demektir. */
  attempt: number
  data: T | null
  error: ApiError | null
}

/**
 * Sayfa açılışında veri çeker; loading / error / data durumlarını yönetir.
 * Sayfadan çıkıldığında veya yeniden yüklendiğinde devam eden istek iptal edilir.
 */
export function useApi<T>(fetcher: (signal: AbortSignal) => Promise<T>): ApiState<T> {
  const [attempt, setAttempt] = useState(0)
  const [result, setResult] = useState<Result<T>>({ attempt: -1, data: null, error: null })

  // Satır içi fetcher'lar her render'da yeniden oluşur; effect'i yeniden tetiklemesinler.
  const load = useEffectEvent((signal: AbortSignal) => fetcher(signal))

  useEffect(() => {
    const controller = new AbortController()
    load(controller.signal)
      .then((data) => setResult({ attempt, data, error: null }))
      .catch((err: unknown) => {
        if (controller.signal.aborted || isAbortError(err)) return
        setResult((previous) => ({ attempt, data: previous.data, error: toApiError(err) }))
      })
    return () => controller.abort()
  }, [attempt])

  const reload = useCallback(() => setAttempt((n) => n + 1), [])
  const loading = result.attempt !== attempt

  return { data: result.data, error: loading ? null : result.error, loading, reload }
}
