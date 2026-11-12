// Clario'nun kullandığı portlar ve bu portları dinleyen süreçler (dev.mjs ve stop.mjs ortak kullanır).
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
export const isWindows = process.platform === 'win32'

/** Arayüz portu (frontend/vite.config.ts ile aynı) */
export const WEB_PORT = 5180

/** API portu: backend/.env içindeki PORT, yoksa 4000 */
export function apiPort() {
  try {
    const env = fs.readFileSync(path.join(root, 'backend', '.env'), 'utf8')
    const match = env.match(/^\s*PORT\s*=\s*(\d+)/m)
    if (match) return Number(match[1])
  } catch {
    // .env yok: varsayılan
  }
  return 4000
}

/** Portu dinleyen süreçlerin kimlikleri (PID) */
export function listeners(port) {
  try {
    if (isWindows) {
      const output = execFileSync('netstat', ['-ano', '-p', 'TCP'], { encoding: 'utf8' })
      const pids = new Set()
      for (const line of output.split(/\r?\n/)) {
        const parts = line.trim().split(/\s+/)
        if (parts[3] === 'LISTENING' && parts[1]?.endsWith(`:${port}`)) pids.add(Number(parts[4]))
      }
      // IPv6 satırları da (ör. [::]:5180) aynı biçimde gelir; ayrı sorgu gerekmez
      const v6 = execFileSync('netstat', ['-ano', '-p', 'TCPv6'], { encoding: 'utf8' })
      for (const line of v6.split(/\r?\n/)) {
        const parts = line.trim().split(/\s+/)
        if (parts[3] === 'LISTENING' && parts[1]?.endsWith(`:${port}`)) pids.add(Number(parts[4]))
      }
      return [...pids].filter((pid) => pid > 0)
    }
    const output = execFileSync('lsof', ['-ti', `tcp:${port}`, '-sTCP:LISTEN'], { encoding: 'utf8' })
    return output.split(/\s+/).filter(Boolean).map(Number)
  } catch {
    return []
  }
}

/** Bu adreste Clario arayüzü mü çalışıyor? */
export async function isClarioWeb(port) {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/`, { headers: { connection: 'close' }, signal: AbortSignal.timeout(2000) })
    return (await response.text()).includes('<title>Clario</title>')
  } catch {
    return false
  }
}

/** Bu adreste Clario API'si mi çalışıyor? */
export async function isClarioApi(port) {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/auth/status`, { headers: { connection: 'close' }, signal: AbortSignal.timeout(2000) })
    return response.ok && 'passwordMinLength' in (await response.json())
  } catch {
    return false
  }
}

/** Süreci alt süreçleriyle birlikte kapatır */
export function kill(pid) {
  try {
    if (isWindows) execFileSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' })
    else process.kill(pid, 'SIGTERM')
    return true
  } catch {
    return false
  }
}
