// Arayüzün API isteklerini (axios) ağ yerine uygulama içindeki backend'e ileten köprü.
// İstekler sırayla işlenir: backend'in istek bağlamı (para birimi) tek bir değişkende tutulduğu için
// (bkz. shims/async-hooks.ts) aynı anda yalnızca bir istek çalışır. Uygulama içinde olduğu için bu fark edilmez.
import { AxiosError, AxiosHeaders, type AxiosAdapter, type AxiosResponse, type InternalAxiosRequestConfig } from 'axios'
import { Buffer } from 'buffer'
import type { ShimApp, ShimRequest } from './shims/express'

const TIMEOUT_MS = 120_000

class InProcessResponse {
  statusCode = 200
  headersSent = false
  body: unknown = undefined
  private readonly headers = new Map<string, string | string[]>()
  private readonly finishListeners: (() => void)[] = []
  private resolveDone!: () => void
  readonly done = new Promise<void>((resolve) => (this.resolveDone = resolve))

  status(code: number) {
    this.statusCode = code
    return this
  }
  setHeader(name: string, value: string | string[]) {
    this.headers.set(name.toLowerCase(), value)
    return this
  }
  getHeader(name: string) {
    return this.headers.get(name.toLowerCase())
  }
  append(name: string, value: string) {
    const key = name.toLowerCase()
    const previous = this.headers.get(key)
    this.headers.set(key, previous === undefined ? [value] : ([] as string[]).concat(previous, value))
    return this
  }
  on(event: string, listener: () => void) {
    if (event === 'finish') this.finishListeners.push(listener)
    return this
  }
  json(body: unknown) {
    this.setHeader('content-type', 'application/json')
    return this.end(body)
  }
  send(body: unknown) {
    return this.end(body)
  }
  sendStatus(code: number) {
    return this.status(code).end()
  }
  redirect(url: string) {
    this.setHeader('location', url)
    return this.status(302).end()
  }
  end(body?: unknown) {
    if (this.headersSent) return this
    this.body = body
    this.headersSent = true
    for (const listener of this.finishListeners) {
      try {
        listener()
      } catch (error) {
        console.error('[clario] Yanıt sonrası işlem başarısız:', error)
      }
    }
    this.resolveDone()
    return this
  }
  allHeaders(): Record<string, string> {
    const out: Record<string, string> = {}
    for (const [key, value] of this.headers) out[key] = Array.isArray(value) ? value.join(', ') : value
    return out
  }
  setCookies(): string[] {
    const value = this.headers.get('set-cookie')
    return value === undefined ? [] : ([] as string[]).concat(value)
  }
}

/** Oturum çerezleri (yalnızca bellekte; uygulama kapanınca oturum da kapanır ve veri kilitlenir) */
class CookieJar {
  private readonly cookies = new Map<string, string>()

  store(headers: string[]) {
    for (const header of headers) {
      const [pair, ...attributes] = header.split(';')
      const [name, ...rest] = pair!.trim().split('=')
      const value = rest.join('=')
      const expired = attributes.some((a) => /^\s*max-age\s*=\s*0\s*$/i.test(a))
      if (!name) continue
      if (!value || expired) this.cookies.delete(name)
      else this.cookies.set(name, value)
    }
  }

  header(): string {
    return [...this.cookies].map(([name, value]) => `${name}=${value}`).join('; ')
  }
}

async function toBody(data: unknown): Promise<unknown> {
  if (data === undefined || data === null) return undefined
  if (typeof data === 'string') return data
  if (data instanceof Blob) return Buffer.from(await data.arrayBuffer())
  if (data instanceof ArrayBuffer) return Buffer.from(data)
  if (ArrayBuffer.isView(data)) return Buffer.from(data.buffer, data.byteOffset, data.byteLength)
  return JSON.stringify(data)
}

export function createInProcessAdapter(app: ShimApp): AxiosAdapter {
  const jar = new CookieJar()
  let queue: Promise<unknown> = Promise.resolve()

  async function dispatch(config: InternalAxiosRequestConfig): Promise<AxiosResponse> {
    const base = config.baseURL ?? ''
    const target = new URL(/^https?:/.test(config.url ?? '') ? config.url! : base.replace(/\/$/, '') + (config.url ?? ''), 'https://clario.app')
    for (const [key, value] of Object.entries((config.params ?? {}) as Record<string, unknown>)) {
      if (value !== undefined && value !== null) target.searchParams.set(key, String(value))
    }

    const headers: Record<string, string> = {}
    for (const [key, value] of Object.entries(AxiosHeaders.from(config.headers).toJSON())) {
      if (value !== undefined && value !== null && value !== false) headers[key.toLowerCase()] = String(value)
    }
    const cookie = jar.header()
    if (cookie) headers.cookie = cookie

    const request: ShimRequest = {
      method: (config.method ?? 'get').toUpperCase(),
      url: target.pathname + target.search,
      originalUrl: target.pathname + target.search,
      path: target.pathname,
      baseUrl: '',
      query: Object.fromEntries(target.searchParams),
      params: {},
      headers,
      body: await toBody(config.data),
      ip: '127.0.0.1',
      secure: false,
      socket: { remoteAddress: '127.0.0.1' },
      get: (name) => headers[name.toLowerCase()],
      header: (name) => headers[name.toLowerCase()],
    }

    const response = new InProcessResponse()
    app.handle(request, response)
    let timer: ReturnType<typeof setTimeout> | undefined
    await Promise.race([
      response.done,
      new Promise<void>((_, reject) => {
        timer = setTimeout(() => reject(new AxiosError('İstek zaman aşımına uğradı', AxiosError.ECONNABORTED, config)), config.timeout || TIMEOUT_MS)
      }),
    ]).finally(() => clearTimeout(timer))
    jar.store(response.setCookies())

    // İstenen yanıt türü: dosya indirme için ham bayt, diğerlerinde JSON
    let data = response.body
    if (config.responseType === 'arraybuffer' || config.responseType === 'blob') {
      const raw = data instanceof Uint8Array ? data : Buffer.from(typeof data === 'string' ? data : JSON.stringify(data ?? ''))
      data = config.responseType === 'blob' ? new Blob([raw]) : raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength)
    }

    const result: AxiosResponse = {
      data,
      status: response.statusCode,
      statusText: String(response.statusCode),
      headers: AxiosHeaders.from(response.allHeaders()),
      config,
      request: {},
    }
    const validate = config.validateStatus ?? ((status: number) => status >= 200 && status < 300)
    if (!validate(result.status)) {
      throw new AxiosError(
        `Request failed with status code ${result.status}`,
        result.status >= 500 ? AxiosError.ERR_BAD_RESPONSE : AxiosError.ERR_BAD_REQUEST,
        config,
        {},
        result,
      )
    }
    return result
  }

  return (config) => {
    const run = queue.then(() => dispatch(config))
    queue = run.catch(() => undefined)
    return run
  }
}
