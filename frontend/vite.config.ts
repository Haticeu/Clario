import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')

  // Arayüz API'ye göreli "/api" yolundan ulaşır; Vite bu istekleri bu bilgisayardaki backend'e
  // iletir. Böylece aynı ağdaki başka bir cihazdan açıldığında da API çağrıları çalışır
  // (o cihazda "localhost" kendisini gösterirdi) ve tarayıcı açısından istek aynı kaynaklı olur.
  const proxy = {
    '/api': { target: env.API_PROXY_TARGET || 'http://localhost:4000', changeOrigin: true },
  }

  return {
    plugins: [react()],
    server: {
      // Yerel ağa aç: aynı ağdaki cihazlar http://<bu-bilgisayarın-IP'si>:5180 ile erişebilir.
      host: true,
      // Clario'ya ayrılmış sabit port. 5173 Vite'ın varsayılanıdır ve başka projelerle çakışır (ör. biri IPv4'te,
      // diğeri IPv6'da dinleyince "localhost" yanlış uygulamayı açar). Port doluysa başka porta kaymak yerine hata
      // verilir; böylece adres (ve Google girişinin dönüş adresi) hep aynı kalır.
      port: 5180,
      strictPort: true,
      proxy,
    },
    preview: {
      host: true,
      port: 5181,
      proxy,
    },
  }
})
