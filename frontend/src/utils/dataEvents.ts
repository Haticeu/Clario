/**
 * Veri değiştiğinde (kayıt eklendi, silindi, Excel yüklendi) uygulamanın diğer bölümlerine haber verir;
 * örneğin sol menüdeki "Veri tarihi" yenilenir.
 */
const EVENT = 'clario:data-changed'

export function notifyDataChanged(): void {
  window.dispatchEvent(new Event(EVENT))
}

export function onDataChanged(listener: () => void): () => void {
  window.addEventListener(EVENT, listener)
  return () => window.removeEventListener(EVENT, listener)
}
