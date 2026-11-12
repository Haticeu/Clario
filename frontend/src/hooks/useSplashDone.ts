import { useEffect, useState } from 'react'

const SPLASH_KEY = 'clario-splash-shown'
const SPLASH_MS = 1600

function shownThisSession(): boolean {
  try {
    return sessionStorage.getItem(SPLASH_KEY) === '1'
  } catch {
    return false
  }
}

/**
 * Açılış ekranı en az bu kadar görünür (sekme başına bir kez; sayfa yenilemelerinde tekrar beklenmez).
 * true dönünce uygulama gösterilebilir.
 */
export function useSplashDone(): boolean {
  const [done, setDone] = useState(shownThisSession)
  useEffect(() => {
    if (done) return
    const timer = setTimeout(() => {
      try {
        sessionStorage.setItem(SPLASH_KEY, '1')
      } catch {
        // Depolama kapalıysa her açılışta gösterilir; sorun değil.
      }
      setDone(true)
    }, SPLASH_MS)
    return () => clearTimeout(timer)
  }, [done])
  return done
}
