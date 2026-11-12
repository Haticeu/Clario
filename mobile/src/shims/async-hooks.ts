// node:async_hooks AsyncLocalStorage'ın cihazdaki karşılığı. Uygulama içi API istekleri sırayla işlendiği için
// (bkz. adapter.ts) o anki isteğin bağlamı tek bir değişkende tutulabilir: run() bağlamı ayarlar ve istek bitene
// kadar (sonraki istek kendi bağlamını ayarlayana kadar) korur.
export class AsyncLocalStorage<T> {
  private current: T | undefined

  run<R>(store: T, callback: () => R): R {
    this.current = store
    return callback()
  }

  getStore(): T | undefined {
    return this.current
  }
}

export default { AsyncLocalStorage }
