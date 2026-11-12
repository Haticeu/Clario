// Backend ve frontend geliştirme sunucularını birlikte başlatır; çıktıları etiketleyerek
// tek terminalde gösterir. Ctrl+C ikisini de kapatır. Ek bağımlılık gerektirmez.
import { spawn } from 'node:child_process'
import path from 'node:path'
import { apiPort, isClarioApi, isClarioWeb, isWindows, listeners, root, WEB_PORT } from './ports.mjs'

const url = `http://localhost:${WEB_PORT}`

/**
 * Başlamadan önce portlar boş mu? Clario zaten çalışıyorsa ikinci kez başlatmak yerine adresini söyler.
 * Başlatılabilirse true döner. (process.exit yerine exitCode kullanılır: Windows'ta açık bir bağlantı
 * varken exit, Node'u çökertebiliyor.)
 */
async function portsFree() {
  const api = apiPort()
  const webBusy = listeners(WEB_PORT).length > 0
  const apiBusy = listeners(api).length > 0
  if (!webBusy && !apiBusy) return true

  const [webIsClario, apiIsClario] = await Promise.all([isClarioWeb(WEB_PORT), isClarioApi(api)])
  if (webBusy && apiBusy && webIsClario && apiIsClario) {
    console.log(`\nClario zaten çalışıyor → ${url}`)
    console.log('Bu terminalden yeniden başlatmak için önce eskisini kapatın: npm run stop (sonra tekrar npm run dev)\n')
    return false
  }

  const describe = (name, port, busy, isClario) =>
    busy ? `  • ${name} portu ${port}: ${isClario ? 'başka bir yerde çalışan Clario kullanıyor' : 'başka bir uygulama kullanıyor'}` : null
  console.error('\nClario başlatılamıyor, gereken port(lar) dolu:')
  for (const line of [describe('Arayüz', WEB_PORT, webBusy, webIsClario), describe('API', api, apiBusy, apiIsClario)]) {
    if (line) console.error(line)
  }
  console.error(
    webIsClario || apiIsClario
      ? '\nEski Clario sunucusunu kapatmak için: npm run stop (sonra tekrar npm run dev)\n'
      : '\nO portu kullanan uygulamayı kapatın veya backend/.env içinde farklı bir PORT seçin.\n',
  )
  process.exitCode = 1
  return false
}

function start() {
  const services = [
    { name: 'api', color: '\x1b[36m', cwd: path.join(root, 'backend') },
    { name: 'web', color: '\x1b[35m', cwd: path.join(root, 'frontend') },
  ]

  let stopping = false
  const children = services.map(({ name, color, cwd }) => {
    // Komut tek metin olarak verilir: Windows'ta npm bir kabuk üzerinden çalışmalı; argüman dizisi + shell uyarı üretir
    const child = spawn('npm run dev', { cwd, shell: true, env: { ...process.env, FORCE_COLOR: '1' } })
    const prefix = `${color}[${name}]\x1b[0m `
    const pipe = (stream, target) => {
      let buffer = ''
      stream.on('data', (chunk) => {
        buffer += chunk
        const lines = buffer.split(/\r?\n/)
        buffer = lines.pop() ?? ''
        for (const line of lines) target.write(prefix + line + '\n')
      })
    }
    pipe(child.stdout, process.stdout)
    pipe(child.stderr, process.stderr)
    child.on('exit', (code) => {
      console.log(`${prefix}kapandı (kod ${code ?? 0})`)
      shutdown(code ?? 0)
    })
    return child
  })

  function shutdown(code) {
    if (stopping) return
    stopping = true
    for (const child of children) {
      if (child.exitCode !== null) continue
      // Windows'ta npm bir kabuk üzerinden çalışır; alt süreç ağacının tamamı kapatılmalı.
      if (isWindows) spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' })
      else child.kill('SIGINT')
    }
    setTimeout(() => process.exit(code), 500)
  }

  process.on('SIGINT', () => shutdown(0))
  process.on('SIGTERM', () => shutdown(0))
  console.log(`\nClario başlatılıyor → ${url}  (kapatmak için Ctrl+C)\n`)
}

if (await portsFree()) start()
