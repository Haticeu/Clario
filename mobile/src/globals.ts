// Backend kodunun beklediği Node.js globalleri (ilk import edilen modül olmalı: diğer modüller yüklenirken kullanılır)
import { Buffer } from 'buffer'

const g = globalThis as Record<string, unknown>
g.Buffer ??= Buffer
g.global ??= globalThis
g.process ??= {
  env: {},
  pid: 1,
  platform: 'android',
  version: 'v24.0.0',
  versions: {},
  cwd: () => '/',
  nextTick: (callback: (...args: unknown[]) => void, ...args: unknown[]) => queueMicrotask(() => callback(...args)),
  emitWarning: () => {},
}

// Tarayıcıdaki buffer paketi 'base64url' biçimini tanımaz (Node tanır); oturum anahtarları bu biçimi kullanır
const toBase64Url = (base64: string) => base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
const originalToString = Buffer.prototype.toString
Buffer.prototype.toString = function (this: Buffer, encoding?: string, start?: number, end?: number) {
  if (encoding === 'base64url') return toBase64Url(originalToString.call(this, 'base64', start, end))
  return originalToString.call(this, encoding as BufferEncoding, start, end)
}
const originalFrom = Buffer.from
Buffer.from = function (value: unknown, encodingOrOffset?: unknown, length?: number) {
  if (encodingOrOffset === 'base64url' && typeof value === 'string') {
    return originalFrom.call(Buffer, value.replace(/-/g, '+').replace(/_/g, '/'), 'base64')
  }
  return (originalFrom as (...args: unknown[]) => Buffer).call(Buffer, value, encodingOrOffset, length)
} as typeof Buffer.from
