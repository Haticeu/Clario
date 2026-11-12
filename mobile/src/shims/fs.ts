// node:fs'in Clario'da kullanılan senkron bölümü. Dosyalar bellekte tutulur ve arka planda cihazın uygulamaya özel
// depolama alanına (Capacitor Filesystem, Directory.Data) yazılır; uygulama açılışında oradan geri yüklenir.
// Saklananlar: system.db (kişisel veri içermez), server.key ve her hesabın AES-256-GCM ile şifrelenmiş veri dosyası.
import { Directory, Encoding, Filesystem } from '@capacitor/filesystem'
import { Buffer } from 'buffer'

const ROOT = 'clario'
const files = new Map<string, Uint8Array>()
const dirty = new Set<string>()
const removed = new Set<string>()
let flushTimer: ReturnType<typeof setTimeout> | null = null
let flushing: Promise<void> = Promise.resolve()

const normalize = (path: string) =>
  path
    .replace(/\\/g, '/')
    .replace(/^\.?\//, '')
    .replace(/\/+/g, '/')
    .replace(/\/$/, '')

function enoent(path: string): Error {
  return Object.assign(new Error(`ENOENT: no such file or directory, '${path}'`), { code: 'ENOENT' })
}

/** Açılışta cihazdaki dosyaları belleğe yükler (uygulama başlamadan önce bir kez çağrılır). */
export async function hydrate(): Promise<void> {
  async function walk(dir: string): Promise<void> {
    let entries
    try {
      entries = (await Filesystem.readdir({ path: dir, directory: Directory.Data })).files
    } catch {
      return // klasör henüz yok: ilk açılış
    }
    for (const entry of entries) {
      const path = `${dir}/${entry.name}`
      if (entry.type === 'directory') await walk(path)
      else {
        const { data } = await Filesystem.readFile({ path, directory: Directory.Data })
        const key = normalize(path.slice(ROOT.length + 1))
        files.set(key, typeof data === 'string' ? Buffer.from(data, 'base64') : new Uint8Array(await data.arrayBuffer()))
      }
    }
  }
  await walk(ROOT)
}

/** Değişen dosyaları cihaza yazar. Yazımlar sıraya alınır; kısa aralıklarla gruplanır. */
function scheduleFlush(): void {
  if (flushTimer) return
  flushTimer = setTimeout(() => {
    flushTimer = null
    flushing = flushing.then(flush, flush)
  }, 30)
}

async function flush(): Promise<void> {
  const writes = [...dirty]
  const deletes = [...removed]
  dirty.clear()
  removed.clear()
  for (const path of writes) {
    const data = files.get(path)
    if (!data) continue
    await Filesystem.writeFile({ path: `${ROOT}/${path}`, data: Buffer.from(data).toString('base64'), directory: Directory.Data, recursive: true })
  }
  for (const path of deletes) {
    if (files.has(path)) continue
    await Filesystem.deleteFile({ path: `${ROOT}/${path}`, directory: Directory.Data }).catch(() => undefined)
  }
}

/** Bekleyen yazımların bitmesini bekler (ör. uygulama arka plana alınırken). */
export async function flushNow(): Promise<void> {
  if (flushTimer) {
    clearTimeout(flushTimer)
    flushTimer = null
    flushing = flushing.then(flush, flush)
  }
  await flushing
}

function write(path: string, data: Uint8Array): void {
  const key = normalize(path)
  files.set(key, data)
  removed.delete(key)
  dirty.add(key)
  scheduleFlush()
}

export function existsSync(path: string): boolean {
  const key = normalize(path)
  if (files.has(key)) return true
  // Klasörler örtük: içinde dosya varsa klasör de var sayılır
  return [...files.keys()].some((file) => file.startsWith(`${key}/`))
}

export function readFileSync(path: string, options?: string | { encoding?: string }): Buffer | string {
  const data = files.get(normalize(path))
  if (!data) throw enoent(path)
  const encoding = typeof options === 'string' ? options : options?.encoding
  const buffer = Buffer.from(data)
  return encoding ? buffer.toString(encoding as BufferEncoding) : buffer
}

export function writeFileSync(path: string, data: string | Uint8Array, options?: string | { encoding?: string; flag?: string }): void {
  const flag = typeof options === 'object' ? options.flag : undefined
  if (flag === 'wx' && files.has(normalize(path))) throw Object.assign(new Error(`EEXIST: '${path}'`), { code: 'EEXIST' })
  write(path, typeof data === 'string' ? Buffer.from(data, 'utf8') : new Uint8Array(data))
}

export function mkdirSync(): void {
  // Klasörler örtük (bkz. existsSync)
}

export function renameSync(from: string, to: string): void {
  const data = files.get(normalize(from))
  if (!data) throw enoent(from)
  files.delete(normalize(from))
  removed.add(normalize(from))
  write(to, data)
}

export function rmSync(path: string, options: { recursive?: boolean; force?: boolean } = {}): void {
  const key = normalize(path)
  const targets = [...files.keys()].filter((file) => file === key || (options.recursive && file.startsWith(`${key}/`)))
  if (targets.length === 0 && !options.force) throw enoent(path)
  for (const file of targets) {
    files.delete(file)
    dirty.delete(file)
    removed.add(file)
  }
  scheduleFlush()
}

export function readdirSync(path: string): string[] {
  const key = normalize(path)
  const names = new Set<string>()
  for (const file of files.keys()) {
    if (file.startsWith(`${key}/`)) names.add(file.slice(key.length + 1).split('/')[0]!)
  }
  return [...names]
}

// Dosya tanıtıcıları: writeEncryptedWorkspace geçici dosyaya yazıp yeniden adlandırır
const handles = new Map<number, { path: string; chunks: Uint8Array[] }>()
let nextHandle = 3

export function openSync(path: string): number {
  const fd = nextHandle++
  handles.set(fd, { path, chunks: [] })
  return fd
}

export function writeSync(fd: number, data: Uint8Array): number {
  handles.get(fd)?.chunks.push(new Uint8Array(data))
  return data.length
}

export function fsyncSync(): void {
  // Yazım closeSync'te tamamlanır
}

export function closeSync(fd: number): void {
  const handle = handles.get(fd)
  handles.delete(fd)
  if (handle) write(handle.path, Buffer.concat(handle.chunks))
}

export { Encoding }

export default { existsSync, readFileSync, writeFileSync, mkdirSync, renameSync, rmSync, readdirSync, openSync, writeSync, fsyncSync, closeSync }
