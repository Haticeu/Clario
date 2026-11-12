// node:crypto'nun Clario'da kullanılan bölümü, cihazda (WebView) çalışan karşılığı.
// AES-256-GCM, SHA-256, HMAC, HKDF ve scrypt: denetlenmiş @noble kütüphaneleri; rastgelelik: Web Crypto.
import { gcm } from '@noble/ciphers/aes.js'
import { hkdf } from '@noble/hashes/hkdf.js'
import { hmac } from '@noble/hashes/hmac.js'
import { scryptAsync } from '@noble/hashes/scrypt.js'
import { sha256 } from '@noble/hashes/sha2.js'
import { Buffer } from 'buffer'

type BinaryLike = string | Uint8Array

const bytes = (value: BinaryLike): Uint8Array => (typeof value === 'string' ? new TextEncoder().encode(value) : value)

export function randomBytes(size: number): Buffer {
  const out = new Uint8Array(size)
  // getRandomValues tek seferde en fazla 65536 bayt üretir
  for (let i = 0; i < size; i += 65536) crypto.getRandomValues(out.subarray(i, Math.min(i + 65536, size)))
  return Buffer.from(out)
}

export function randomUUID(): string {
  return crypto.randomUUID()
}

function assertGcm(algorithm: string) {
  if (algorithm !== 'aes-256-gcm') throw new Error(`Desteklenmeyen algoritma: ${algorithm}`)
}

/** createCipheriv('aes-256-gcm', key, iv): update() boş döner, şifreli metin final()'da, etiket getAuthTag()'te */
export function createCipheriv(algorithm: string, key: Uint8Array, iv: Uint8Array) {
  assertGcm(algorithm)
  let aad: Uint8Array | undefined
  const chunks: Uint8Array[] = []
  let tag: Buffer | null = null
  return {
    setAAD(data: Uint8Array) {
      aad = data
      return this
    },
    update(data: BinaryLike) {
      chunks.push(bytes(data))
      return Buffer.alloc(0)
    },
    final() {
      const sealed = gcm(key, iv, aad).encrypt(Buffer.concat(chunks))
      tag = Buffer.from(sealed.subarray(sealed.length - 16))
      return Buffer.from(sealed.subarray(0, sealed.length - 16))
    },
    getAuthTag() {
      if (!tag) throw new Error('getAuthTag, final() çağrılmadan kullanılamaz')
      return tag
    },
  }
}

/** createDecipheriv: etiket doğrulanamazsa final() hata fırlatır (Node ile aynı davranış) */
export function createDecipheriv(algorithm: string, key: Uint8Array, iv: Uint8Array) {
  assertGcm(algorithm)
  let aad: Uint8Array | undefined
  let tag: Uint8Array | null = null
  const chunks: Uint8Array[] = []
  return {
    setAAD(data: Uint8Array) {
      aad = data
      return this
    },
    setAuthTag(value: Uint8Array) {
      tag = value
      return this
    },
    update(data: Uint8Array) {
      chunks.push(data)
      return Buffer.alloc(0)
    },
    final() {
      if (!tag) throw new Error('Kimlik doğrulama etiketi yok')
      return Buffer.from(gcm(key, iv, aad).decrypt(Buffer.concat([...chunks, tag])))
    },
  }
}

function digestOutput(result: Uint8Array, encoding?: string) {
  const buffer = Buffer.from(result)
  return encoding ? buffer.toString(encoding as BufferEncoding) : buffer
}

export function createHash(algorithm: string) {
  if (algorithm !== 'sha256') throw new Error(`Desteklenmeyen özet: ${algorithm}`)
  const hash = sha256.create()
  return {
    update(data: BinaryLike) {
      hash.update(bytes(data))
      return this
    },
    digest: (encoding?: string) => digestOutput(hash.digest(), encoding),
  }
}

export function createHmac(algorithm: string, key: BinaryLike) {
  if (algorithm !== 'sha256') throw new Error(`Desteklenmeyen HMAC: ${algorithm}`)
  const mac = hmac.create(sha256, bytes(key))
  return {
    update(data: BinaryLike) {
      mac.update(bytes(data))
      return this
    },
    digest: (encoding?: string) => digestOutput(mac.digest(), encoding),
  }
}

export function hkdfSync(digest: string, ikm: BinaryLike, salt: BinaryLike, info: BinaryLike, length: number): ArrayBuffer {
  if (digest !== 'sha256') throw new Error(`Desteklenmeyen HKDF: ${digest}`)
  const out = hkdf(sha256, bytes(ikm), bytes(salt), bytes(info), length)
  return out.buffer.slice(out.byteOffset, out.byteOffset + out.byteLength) as ArrayBuffer
}

type ScryptOptions = { N: number; r: number; p: number; maxmem?: number }

export function scrypt(
  password: BinaryLike,
  salt: BinaryLike,
  keylen: number,
  options: ScryptOptions,
  callback: (error: Error | null, key: Buffer) => void,
): void {
  // asyncTick: arayüz donmasın diye aralıklarla ara verilir; ara sık olursa (varsayılan 10 ms) arka planda çok yavaşlar
  scryptAsync(bytes(password), bytes(salt), { N: options.N, r: options.r, p: options.p, dkLen: keylen, maxmem: options.maxmem, asyncTick: 300 })
    .then((key) => callback(null, Buffer.from(key)))
    .catch((error: Error) => callback(error, Buffer.alloc(0)))
}

export function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) throw new RangeError('Girdi uzunlukları eşit olmalı')
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a[i]! ^ b[i]!
  return diff === 0
}

export default { randomBytes, randomUUID, createCipheriv, createDecipheriv, createHash, createHmac, hkdfSync, scrypt, timingSafeEqual }
