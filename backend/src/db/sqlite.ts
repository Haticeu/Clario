import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync, type StatementSync } from 'node:sqlite';
import type { DbClient, SnapshotDbClient, SqlParam } from './types.js';

/**
 * Node'un yerleşik SQLite modülü (node:sqlite) üzerine DbClient.
 * Native derleme veya dış bağımlılık gerektirmez; senkron API, arayüz gereği Promise ile sarmalanır.
 */
function wrap(db: DatabaseSync, onWrite: () => void = () => {}): DbClient {
  const statements = new Map<string, StatementSync>();
  const prepare = (sql: string): StatementSync => {
    let statement = statements.get(sql);
    if (!statement) {
      statement = db.prepare(sql);
      statements.set(sql, statement);
    }
    return statement;
  };

  let inTransaction = false;

  const client: DbClient = {
    dialect: 'sqlite',

    async query<T>(sql: string, params: readonly SqlParam[] = []) {
      return prepare(sql).all(...params) as T[];
    },

    async queryOne<T>(sql: string, params: readonly SqlParam[] = []) {
      return prepare(sql).get(...params) as T | undefined;
    },

    async execute(sql: string, params: readonly SqlParam[] = []) {
      const result = prepare(sql).run(...params);
      if (Number(result.changes) > 0) onWrite();
      return { changes: Number(result.changes) };
    },

    async executeScript(sql: string) {
      statements.clear(); // DDL, önbellekteki hazır ifadeleri geçersiz kılabilir
      db.exec(sql);
      onWrite();
    },

    // Tek bağlantı kullanıldığı için iç içe çağrılar mevcut işleme katılır.
    async transaction<T>(work: (tx: DbClient) => Promise<T>) {
      if (inTransaction) return work(client);
      inTransaction = true;
      db.exec('BEGIN');
      try {
        const result = await work(client);
        db.exec('COMMIT');
        return result;
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      } finally {
        inTransaction = false;
      }
    },

    async close() {
      if (db.isOpen) db.close();
    },
  };

  return client;
}

/** Dosyadaki (veya ':memory:') veritabanı. Sistem kayıtları ve test verisi için. */
export function createSqliteClient(filename: string): DbClient {
  if (filename !== ':memory:') {
    fs.mkdirSync(path.dirname(filename), { recursive: true });
  }
  const db = new DatabaseSync(filename);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
  return wrap(db);
}

/**
 * Tamamen bellekte çalışan veritabanı. Diske hiçbir zaman düz metin yazılmaz: içerik serialize() ile
 * alınıp şifrelenerek saklanır ve açılışta şifresi çözülen görüntüden (snapshot) yüklenir.
 */
export function createSnapshotClient(snapshot?: Uint8Array): SnapshotDbClient {
  const db = new DatabaseSync(':memory:');
  if (snapshot) db.deserialize(snapshot);
  db.exec('PRAGMA foreign_keys = ON;');
  let dirty = false;
  const client = wrap(db, () => {
    dirty = true;
  });
  return {
    ...client,
    serialize: () => db.serialize(),
    isDirty: () => dirty,
    markClean: () => {
      dirty = false;
    },
  };
}
