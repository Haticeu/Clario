// Express'in Clario'da kullanılan bölümü, ağ olmadan uygulama içinde çalışan küçük bir karşılık.
// Backend'in yönlendiricileri (routes, dataRoutes, authRoutes…) değişmeden cihazda çalışır; istekler HTTP yerine
// adapter.ts üzerinden doğrudan buraya gelir. Express 5 davranışları korunur: async işleyicilerdeki hatalar hata
// işleyicisine gider, 4 parametreli işleyiciler hata işleyicisidir, use() önek eşler ve yolu kırpar.
import { Buffer } from 'buffer'

type Next = (error?: unknown) => void
type Handler = (...args: unknown[]) => unknown

export interface ShimRequest {
  method: string
  url: string
  originalUrl: string
  path: string
  baseUrl: string
  query: Record<string, string>
  params: Record<string, string>
  headers: Record<string, string>
  body: unknown
  ip: string
  secure: boolean
  socket: { remoteAddress: string }
  get(name: string): string | undefined
  header(name: string): string | undefined
}

interface Layer {
  method: string | null
  paths: string[]
  end: boolean
  handlers: Handler[]
}

function compile(path: string, end: boolean): { regex: RegExp; keys: string[] } {
  const keys: string[] = []
  const trimmed = path === '/' ? '' : path.replace(/\/$/, '')
  const source = trimmed
    .split('/')
    .map((part) => {
      if (part.startsWith(':')) {
        keys.push(part.slice(1))
        return '([^/]+)'
      }
      return part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    })
    .join('/')
  return { regex: new RegExp(end ? `^${source}/?$` : `^${source}(?=/|$)`, 'i'), keys }
}

function match(layer: Layer, path: string): { matched: string; params: Record<string, string> } | null {
  for (const candidate of layer.paths) {
    const { regex, keys } = compile(candidate, layer.end)
    const result = regex.exec(path)
    if (!result) continue
    const params: Record<string, string> = {}
    keys.forEach((key, i) => (params[key] = decodeURIComponent(result[i + 1]!)))
    return { matched: result[0], params }
  }
  return null
}

const isPathArg = (value: unknown) => typeof value === 'string' || Array.isArray(value)

export interface ShimRouter {
  (req: ShimRequest, res: unknown, next: Next): void
  use(...args: unknown[]): ShimRouter
  get(path: string, ...handlers: Handler[]): ShimRouter
  post(path: string, ...handlers: Handler[]): ShimRouter
  put(path: string, ...handlers: Handler[]): ShimRouter
  patch(path: string, ...handlers: Handler[]): ShimRouter
  delete(path: string, ...handlers: Handler[]): ShimRouter
}

export function Router(): ShimRouter {
  const stack: Layer[] = []

  const router = ((req: ShimRequest, res: unknown, out: Next) => {
    let index = 0
    const next: Next = (error) => {
      const layer = stack[index++]
      if (!layer) return out(error)
      if (layer.method && layer.method !== req.method) return next(error)
      const found = match(layer, req.path)
      if (!found) return next(error)

      const savedPath = req.path
      const savedBase = req.baseUrl
      req.params = { ...req.params, ...found.params }
      if (!layer.method) {
        // use(): eşleşen öneki kırp (Express gibi), alt yönlendirici kalan yola bakar
        req.baseUrl = savedBase + found.matched
        req.path = savedPath.slice(found.matched.length) || '/'
        if (!req.path.startsWith('/')) req.path = `/${req.path}`
      }
      const restore = () => {
        req.path = savedPath
        req.baseUrl = savedBase
      }

      let i = 0
      const step: Next = (err) => {
        const handler = layer.handlers[i++]
        if (!handler) {
          restore()
          return next(err)
        }
        const isErrorHandler = handler.length === 4
        if ((err && !isErrorHandler) || (!err && isErrorHandler)) return step(err)
        try {
          const result = isErrorHandler ? handler(err, req, res, step) : handler(req, res, step)
          if (result && typeof (result as Promise<unknown>).then === 'function') {
            ;(result as Promise<unknown>).catch((e) => step(e ?? new Error('İşleyici reddedildi')))
          }
        } catch (e) {
          step(e)
        }
      }
      step(error)
    }
    next()
  }) as ShimRouter

  router.use = (...args: unknown[]) => {
    const paths = isPathArg(args[0]) ? ([] as string[]).concat(args.shift() as string | string[]) : ['/']
    stack.push({ method: null, paths, end: false, handlers: (args.flat() as Handler[]) })
    return router
  }
  for (const method of ['get', 'post', 'put', 'patch', 'delete'] as const) {
    router[method] = (path: string, ...handlers: Handler[]) => {
      stack.push({ method: method.toUpperCase(), paths: [path], end: true, handlers: handlers.flat() as Handler[] })
      return router
    }
  }
  return router
}

/** express.json(): gövde metin olarak geldiyse ayrıştırır */
function json() {
  return (req: ShimRequest, _res: unknown, next: Next) => {
    const type = req.get('content-type') ?? ''
    if (typeof req.body === 'string' && type.includes('json')) {
      try {
        req.body = req.body.trim() ? JSON.parse(req.body) : {}
      } catch {
        return next({ type: 'entity.parse.failed' })
      }
    }
    next()
  }
}

/** express.raw(): gövdeyi Buffer'a çevirir (Excel/CSV yükleme) */
function raw() {
  return (req: ShimRequest, _res: unknown, next: Next) => {
    if (req.body instanceof Uint8Array && !Buffer.isBuffer(req.body)) req.body = Buffer.from(req.body)
    else if (typeof req.body === 'string') req.body = Buffer.from(req.body)
    else if (req.body === undefined || req.body === null) req.body = Buffer.alloc(0)
    next()
  }
}

export interface ShimApp extends ShimRouter {
  disable(name: string): void
  set(name: string, value: unknown): void
  /** Uygulama içi isteği işler; yanıt bittiğinde res üzerinden bildirilir */
  handle(req: ShimRequest, res: unknown): void
}

function express(): ShimApp {
  const app = Router() as ShimApp
  app.disable = () => {}
  app.set = () => {}
  app.handle = (req, res) =>
    app(req, res, (error) => {
      const response = res as { headersSent: boolean; status(code: number): { json(body: unknown): void } }
      if (response.headersSent) return
      if (error) {
        console.error('[clario] İşlenmeyen hata:', error)
        response.status(500).json({ error: { message: 'Beklenmeyen bir hata oluştu.' } })
      } else response.status(404).json({ error: { message: `Endpoint bulunamadı: ${req.method} ${req.originalUrl}` } })
    })
  return app
}

express.json = json
express.raw = raw
express.Router = Router

export default express
