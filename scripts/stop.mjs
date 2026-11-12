// Arka planda veya başka bir terminalde çalışmaya devam eden Clario sunucularını kapatır: npm run stop
// Yalnızca gerçekten Clario olan süreçler kapatılır; aynı portu başka bir uygulama kullanıyorsa dokunulmaz.
import { apiPort, isClarioApi, isClarioWeb, kill, listeners, WEB_PORT } from './ports.mjs'

const targets = [
  { name: 'Arayüz', port: WEB_PORT, check: isClarioWeb },
  { name: 'API', port: apiPort(), check: isClarioApi },
]

let stopped = 0
for (const { name, port, check } of targets) {
  const pids = listeners(port)
  if (pids.length === 0) continue
  if (!(await check(port))) {
    console.log(`${name} portu ${port} başka bir uygulama tarafından kullanılıyor (PID ${pids.join(', ')}); dokunulmadı.`)
    continue
  }
  for (const pid of pids) if (kill(pid)) stopped++
  console.log(`${name} kapatıldı (port ${port}).`)
}
console.log(stopped ? 'Clario durduruldu. Yeniden başlatmak için: npm run dev' : 'Çalışan bir Clario sunucusu bulunamadı.')
