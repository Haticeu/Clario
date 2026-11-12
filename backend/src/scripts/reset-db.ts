/**
 * Bu kurulumdaki TÜM hesapları ve şifreli verilerini siler (data/system.db ve data/users/).
 * Tek bir hesabı silmek için uygulamadaki Ayarlar → Hesabı sil seçeneğini kullanın.
 *
 *   npm run db:reset -- --yes
 *
 * Yanlışlıkla çalıştırılmasın diye --yes onayı zorunludur. Backend kapalıyken çalıştırın.
 */
import fs from 'node:fs';
import path from 'node:path';
import { env } from '../config/env.js';

const targets = [path.join(env.dataDir, 'system.db'), path.join(env.dataDir, 'users')];

if (!process.argv.includes('--yes')) {
  console.error(`Bu komut ${env.dataDir} içindeki TÜM hesapları ve verilerini kalıcı olarak siler.`);
  console.error('Onaylamak için (backend kapalıyken): npm run db:reset -- --yes');
  process.exit(1);
}

for (const target of targets) {
  for (const suffix of ['', '-wal', '-shm']) fs.rmSync(target + suffix, { recursive: true, force: true });
}
console.log(`Tüm hesaplar ve şifreli veriler silindi → ${env.dataDir}`);
