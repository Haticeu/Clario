// node:sqlite'ın DatabaseSync API'si, cihazda sql.js (WebAssembly ile derlenmiş SQLite) üzerinde.
// Bellekteki veritabanı serialize/deserialize ile şifreli dosyaya yazılır; dosya tabanlı olan (system.db)
// her değişiklikten sonra fs katmanına (oradan cihaz depolamasına) yazılır.
import initSqlJs, { type Database, type SqlJsStatic, type SqlValue } from 'sql.js'
import wasmUrl from 'sql.js/dist/sql-wasm.wasm?url'
import fs from './fs'

let SQL: SqlJsStatic | null = null

/** WebAssembly modülünü yükler (uygulama başlamadan önce bir kez). */
export async function initSqlite(): Promise<void> {
  SQL ??= await initSqlJs({ locateFile: () => wasmUrl })
}

function engine(): SqlJsStatic {
  if (!SQL) throw new Error('SQLite henüz yüklenmedi (initSqlite çağrılmalı)')
  return SQL
}

type Params = SqlValue[]
type Prepared = ReturnType<Database['prepare']>

/** WAL bellekte çalışan sql.js'te anlamsızdır; bu PRAGMA'lar atlanır */
const UNSUPPORTED_PRAGMA = /PRAGMA\s+(journal_mode|wal_checkpoint)[^;]*;?/gi

class StatementSync {
  constructor(
    private readonly owner: DatabaseSync,
    private readonly sql: string,
  ) {}

  /** Her çağrıda yeniden hazırlanır: sql.js export() sırasında hazır ifadeleri geçersiz kılar */
  private withStatement<T>(params: Params, work: (statement: Prepared) => T): T {
    const statement = this.owner.raw.prepare(this.sql)
    try {
      statement.bind(params)
      return work(statement)
    } finally {
      statement.free()
    }
  }

  all(...params: Params): Record<string, SqlValue>[] {
    return this.withStatement(params, (statement) => {
      const rows: Record<string, SqlValue>[] = []
      while (statement.step()) rows.push(statement.getAsObject())
      return rows
    })
  }

  get(...params: Params): Record<string, SqlValue> | undefined {
    return this.withStatement(params, (statement) => (statement.step() ? statement.getAsObject() : undefined))
  }

  run(...params: Params): { changes: number; lastInsertRowid: number } {
    this.withStatement(params, (statement) => {
      while (statement.step()) {
        // sonuç satırı döndüren ifadeler tüketilir
      }
    })
    const changes = this.owner.raw.getRowsModified()
    this.owner.changed()
    return { changes, lastInsertRowid: 0 }
  }
}

export class DatabaseSync {
  raw: Database
  isOpen = true
  private readonly file: string | null
  private saveTimer: ReturnType<typeof setTimeout> | null = null

  constructor(filename: string, _options?: { readOnly?: boolean }) {
    this.file = filename === ':memory:' ? null : filename
    const existing = this.file && fs.existsSync(this.file) ? (fs.readFileSync(this.file) as Uint8Array) : undefined
    this.raw = new (engine().Database)(existing)
  }

  exec(sql: string): void {
    const script = sql.replace(UNSUPPORTED_PRAGMA, '').trim()
    if (script) this.raw.exec(script)
    this.changed()
  }

  prepare(sql: string): StatementSync {
    return new StatementSync(this, sql)
  }

  serialize(): Uint8Array {
    const data = this.raw.export()
    // sql.js export() bağlantıyı yeniden açar; bağlantı düzeyindeki ayar yeniden uygulanır
    this.raw.exec('PRAGMA foreign_keys = ON;')
    return data
  }

  deserialize(data: Uint8Array): void {
    this.raw.close()
    this.raw = new (engine().Database)(data)
  }

  /** Dosya tabanlı veritabanı (system.db): değişiklikten kısa süre sonra kaydedilir */
  changed(): void {
    if (!this.file || this.saveTimer) return
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null
      if (this.isOpen) fs.writeFileSync(this.file!, this.serialize())
    }, 20)
  }

  close(): void {
    if (!this.isOpen) return
    if (this.file) {
      if (this.saveTimer) clearTimeout(this.saveTimer)
      fs.writeFileSync(this.file, this.serialize())
    }
    this.raw.close()
    this.isOpen = false
  }
}

export default { DatabaseSync }
