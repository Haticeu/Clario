import react from '@vitejs/plugin-react'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'

// Android paketi: React arayüzü (frontend/) + backend (backend/src) tek pakette. Backend'in kullandığı Node.js
// modülleri cihazdaki karşılıklarıyla değiştirilir; backend kodu değişmeden telefonda çalışır.
const here = path.dirname(fileURLToPath(import.meta.url))
const shim = (file: string) => path.join(here, 'src', 'shims', file)

export default defineConfig({
  root: here,
  publicDir: path.join(here, '..', 'frontend', 'public'),
  plugins: [react()],
  resolve: {
    alias: [
      { find: /^node:crypto$/, replacement: shim('crypto.ts') },
      { find: /^node:fs$/, replacement: shim('fs.ts') },
      { find: /^node:sqlite$/, replacement: shim('sqlite.ts') },
      { find: /^node:async_hooks$/, replacement: shim('async-hooks.ts') },
      { find: /^node:path$/, replacement: path.join(here, 'node_modules', 'path-browserify', 'index.js') },
      { find: /^express$/, replacement: shim('express.ts') },
      // Arayüz ve köprü aynı axios kopyasını kullanır
      { find: /^axios$/, replacement: path.join(here, '..', 'frontend', 'node_modules', 'axios') },
    ],
    dedupe: ['react', 'react-dom'],
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'es2022',
    chunkSizeWarningLimit: 4000,
  },
  server: { port: 5190, strictPort: true, fs: { allow: [path.join(here, '..')] } },
  preview: { port: 5190, strictPort: true },
})
