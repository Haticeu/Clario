/**
 * Veritabanından bağımsız istemci arayüzü.
 *
 * Uygulama kodu yalnızca bu arayüzü kullanır; SQLite'a özgü hiçbir API dışarı sızmaz.
 * Postgres'e geçişte yalnızca bu arayüzü uygulayan yeni bir adaptör (ör. `pg` Pool ile)
 * yazmak yeterlidir. Sorgular taşınabilir SQL ile yazılmıştır:
 *  - Parametreler `?` ile verilir (Postgres adaptörü bunları `$1, $2…` biçimine çevirir).
 *  - Tarih hesapları SQL'de değil TypeScript'te yapılır; tarihler 'YYYY-MM-DD' metni olarak saklanır.
 *  - Kolon takma adları çift tırnaklı camelCase'dir ("productId"), iki motor da destekler.
 */
export type SqlParam = string | number | null;

export interface ExecuteResult {
  changes: number;
}

export interface DbClient {
  readonly dialect: 'sqlite' | 'postgres';
  query<T>(sql: string, params?: readonly SqlParam[]): Promise<T[]>;
  queryOne<T>(sql: string, params?: readonly SqlParam[]): Promise<T | undefined>;
  execute(sql: string, params?: readonly SqlParam[]): Promise<ExecuteResult>;
  /** Parametresiz, birden fazla ifade içerebilen betik (DDL) çalıştırır. */
  executeScript(sql: string): Promise<void>;
  transaction<T>(work: (tx: DbClient) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

/** Bellekte çalışan ve içeriği şifrelenip saklanabilen veritabanı (kullanıcı çalışma alanları). */
export interface SnapshotDbClient extends DbClient {
  /** Veritabanının tam görüntüsü (şifrelenip diske yazılır) */
  serialize(): Uint8Array;
  /** Son kayıttan beri veri değişti mi? */
  isDirty(): boolean;
  markClean(): void;
}
