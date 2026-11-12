import { ensureSchema } from './schema.js';
import { createSnapshotClient, createSqliteClient } from './sqlite.js';
import type { DbClient, SnapshotDbClient } from './types.js';

/**
 * Uygulamanın tek veritabanı giriş noktası. Postgres'e geçildiğinde burada
 * DATABASE_URL'e bakarak ilgili adaptör seçilecek; geri kalan kod değişmez.
 */
export async function openDatabase(filename: string): Promise<DbClient> {
  const db = createSqliteClient(filename);
  await ensureSchema(db);
  return db;
}

/** Bellekte çalışan, şifreli görüntüden açılan kullanıcı veritabanı; şema gerekiyorsa güncellenir. */
export async function openSnapshotDatabase(snapshot?: Uint8Array): Promise<SnapshotDbClient> {
  const db = createSnapshotClient(snapshot);
  await ensureSchema(db);
  return db;
}

export type { DbClient, SnapshotDbClient, SqlParam } from './types.js';
