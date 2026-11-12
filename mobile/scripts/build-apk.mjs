// Paylaşılabilir Android APK'sı üretir: arayüz + cihazdaki backend derlenir, Android projesine kopyalanır,
// imzalı "release" APK oluşturulur ve mobile/release/Clario.apk olarak kaydedilir.
//
// Gerekenler: Android SDK (Android Studio ile gelir) ve JDK 21. JDK yolu sırayla: CLARIO_JAVA_HOME,
// ~/.clario-build/jdk/* , JAVA_HOME. (Android Studio'nun JDK 25'i bu Gradle sürümüyle çalışmaz.)
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const android = path.join(root, 'android')
const windows = process.platform === 'win32'

function findJdk() {
  if (process.env.CLARIO_JAVA_HOME) return process.env.CLARIO_JAVA_HOME
  const bundled = path.join(os.homedir(), '.clario-build', 'jdk')
  if (fs.existsSync(bundled)) {
    const jdk = fs.readdirSync(bundled).find((name) => name.startsWith('jdk-21'))
    if (jdk) return path.join(bundled, jdk)
  }
  return process.env.JAVA_HOME
}

function findSdk() {
  return process.env.ANDROID_HOME ?? process.env.ANDROID_SDK_ROOT ?? path.join(os.homedir(), 'AppData', 'Local', 'Android', 'Sdk')
}

function run(command, args, options = {}) {
  console.log(`\n> ${command} ${args.join(' ')}`)
  const result = spawnSync(command, args, { stdio: 'inherit', shell: windows, ...options })
  if (result.status !== 0) {
    console.error(`\nBaşarısız: ${command} ${args.join(' ')}`)
    process.exit(result.status ?? 1)
  }
}

const javaHome = findJdk()
const sdk = findSdk()
if (!javaHome || !fs.existsSync(javaHome)) {
  console.error('JDK 21 bulunamadı. CLARIO_JAVA_HOME ortam değişkenine JDK 21 klasörünü verin.')
  process.exit(1)
}
if (!fs.existsSync(sdk)) {
  console.error(`Android SDK bulunamadı (${sdk}). Android Studio'yu kurun veya ANDROID_HOME verin.`)
  process.exit(1)
}
if (!fs.existsSync(path.join(android, 'keystore.properties'))) {
  console.error('İmza anahtarı yok: mobile/android/keystore.properties ve clario-release.keystore gerekli (bkz. README).')
  process.exit(1)
}
fs.writeFileSync(path.join(android, 'local.properties'), `sdk.dir=${sdk.replace(/\\/g, '\\\\').replace(/:/g, '\\:')}\n`)

const env = { ...process.env, JAVA_HOME: javaHome, ANDROID_HOME: sdk }
run('npx', ['vite', 'build'], { cwd: root })
run('npx', ['cap', 'sync', 'android'], { cwd: root })
// Tam yol (klasör adında boşluk olabilir: tırnakla)
run(`"${path.join(android, windows ? 'gradlew.bat' : 'gradlew')}"`, ['assembleRelease'], { cwd: android, env })

const built = path.join(android, 'app', 'build', 'outputs', 'apk', 'release', 'app-release.apk')
const outDir = path.join(root, 'release')
fs.mkdirSync(outDir, { recursive: true })
const target = path.join(outDir, 'Clario.apk')
fs.copyFileSync(built, target)
console.log(`\nAPK hazır: ${target} (${(fs.statSync(target).size / 1024 / 1024).toFixed(1)} MB)`)
