import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: 'app.clario.mobile',
  appName: 'Clario',
  webDir: 'dist',
  plugins: {
    // Haber (RSS) ve döviz kuru istekleri cihazın kendi HTTP katmanından gider: tarayıcı CORS kısıtına takılmaz
    CapacitorHttp: { enabled: true },
  },
  android: {
    // Uygulama içi sayfa yalnızca https://localhost üzerinden; karışık (http) içerik yok
    allowMixedContent: false,
  },
}

export default config
