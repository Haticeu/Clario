import axios, { isAxiosError, isCancel, type AxiosAdapter } from 'axios'
import type { ApiErrorBody } from '../types'

/** Varsayılan: göreli "/api" (Vite proxy'si backend'e iletir; bkz. vite.config.ts). */
export const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? '/api'

// X-Clario-Client: veri değiştiren isteklerde zorunlu (CSRF koruması; başka siteler bu başlığı ekleyemez)
// Android uygulamasında istekler ağa değil, cihazdaki backend'e gider (bkz. mobile/src/adapter.ts)
const inProcessAdapter = (globalThis as { __clarioAdapter?: AxiosAdapter }).__clarioAdapter

const client = axios.create({
  baseURL: API_BASE_URL,
  timeout: 15_000,
  headers: { 'X-Clario-Client': 'web' },
  ...(inProcessAdapter ? { adapter: inProcessAdapter } : {}),
})

/**
 * Oturum düştüğünde (süre doldu, başka cihazda parola değişti) uygulamaya haber verilir; giriş ekranına
 * dönülür. Giriş/kayıt isteklerinin kendi 401'leri (yanlış parola) bu olayı tetiklemez.
 */
const UNAUTHORIZED_EVENT = 'clario:unauthorized'

client.interceptors.response.use(undefined, (error: unknown) => {
  if (isAxiosError(error) && error.response?.status === 401 && !error.config?.url?.startsWith('/auth/')) {
    window.dispatchEvent(new Event(UNAUTHORIZED_EVENT))
  }
  return Promise.reject(error)
})

export function onUnauthorized(listener: () => void): () => void {
  window.addEventListener(UNAUTHORIZED_EVENT, listener)
  return () => window.removeEventListener(UNAUTHORIZED_EVENT, listener)
}

/** Analiz tutarlarının istendiği para birimi; backend her kaydı kendi tarihindeki kurla çevirir. */
export function setRequestCurrency(code: string) {
  client.defaults.headers.common['X-Clario-Currency'] = code
}

/** Kullanıcıya gösterilebilir, sadeleştirilmiş API hatası. */
export class ApiError extends Error {
  readonly status: number | null

  constructor(message: string, status: number | null) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

export function isAbortError(error: unknown): boolean {
  return isCancel(error) || (error instanceof DOMException && error.name === 'AbortError')
}

export function toApiError(error: unknown): ApiError {
  if (error instanceof ApiError) return error
  if (isAxiosError<ApiErrorBody>(error)) {
    if (error.response) {
      const message = error.response.data?.error?.message ?? `Sunucu hatası (${error.response.status})`
      return new ApiError(message, error.response.status)
    }
    if (error.code === 'ECONNABORTED') return new ApiError('Sunucu zamanında yanıt vermedi.', null)
    return new ApiError(`Sunucuya ulaşılamadı. Backend çalışıyor mu? (${API_BASE_URL})`, null)
  }
  return new ApiError(error instanceof Error ? error.message : 'Beklenmeyen bir hata oluştu.', null)
}

export async function apiGet<T>(path: string, signal?: AbortSignal): Promise<T> {
  try {
    const { data } = await client.get<T>(path, { signal })
    return data
  } catch (error) {
    if (isAbortError(error)) throw error
    throw toApiError(error)
  }
}

export async function send<T>(
  method: 'post' | 'put' | 'patch' | 'delete',
  path: string,
  body?: unknown,
  signal?: AbortSignal,
  timeout?: number,
): Promise<T> {
  try {
    const { data } = await client.request<T>({ method, url: path, data: body, signal, timeout })
    return data
  } catch (error) {
    if (isAbortError(error)) throw error
    throw toApiError(error)
  }
}

export const apiPost = <T>(path: string, body: unknown, signal?: AbortSignal, timeout?: number) =>
  send<T>('post', path, body, signal, timeout)
export const apiPut = <T>(path: string, body: unknown, timeout?: number) => send<T>('put', path, body, undefined, timeout)
export const apiPatch = <T>(path: string, body: unknown) => send<T>('patch', path, body)
export const apiDelete = (path: string) => send<void>('delete', path)

/**
 * Dosya yükleme (ham gövde). acceptStatus'taki durum kodları hata sayılmaz; örneğin içe aktarma
 * hatalı satırlar yüzünden reddedildiğinde (422) rapor yine okunabilsin.
 */
export async function apiUpload<T>(path: string, file: Blob, acceptStatus: number[] = [], headers: Record<string, string> = {}): Promise<T> {
  try {
    const { data } = await client.post<T>(path, file, {
      headers: { 'Content-Type': 'application/octet-stream', ...headers },
      timeout: 120_000,
      validateStatus: (status) => (status >= 200 && status < 300) || acceptStatus.includes(status),
    })
    return data
  } catch (error) {
    throw toApiError(error)
  }
}

/** Ham dosya (Excel indirme) */
export async function apiGetBinary(path: string): Promise<ArrayBuffer> {
  try {
    const { data } = await client.get<ArrayBuffer>(path, { responseType: 'arraybuffer', timeout: 120_000 })
    return data
  } catch (error) {
    throw toApiError(error)
  }
}
