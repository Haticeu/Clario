import fs from 'node:fs';
import path from 'node:path';
import type { DbClient } from '../db/types.js';
import { encrypt, decrypt, randomKey } from '../security/crypto.js';
import type { KdfParams } from '../security/crypto.js';

/**
 * Sistem kayıtları (hesaplar). Bu veritabanında kişisel veri yoktur: e-posta yalnızca anahtarlı özet (HMAC)
 * olarak, veri anahtarı yalnızca parola ve kurtarma anahtarıyla şifrelenmiş halde durur.
 */
const SYSTEM_SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id              TEXT PRIMARY KEY,
  email_hash      TEXT NOT NULL UNIQUE,
  kdf_salt        TEXT NOT NULL,
  kdf_params      TEXT NOT NULL,
  key_by_password TEXT NOT NULL,
  recovery_salt   TEXT NOT NULL,
  key_by_recovery TEXT NOT NULL,
  failed_logins   INTEGER NOT NULL DEFAULT 0,
  locked_until    TEXT,
  created_at      TEXT NOT NULL
);
`;

export interface UserRecord {
  id: string;
  emailHash: string;
  kdfSalt: Buffer;
  kdfParams: KdfParams;
  keyByPassword: Buffer;
  recoverySalt: Buffer;
  keyByRecovery: Buffer;
  failedLogins: number;
  lockedUntil: string | null;
}

interface UserRow {
  id: string;
  emailHash: string;
  kdfSalt: string;
  kdfParams: string;
  keyByPassword: string;
  recoverySalt: string;
  keyByRecovery: string;
  failedLogins: number;
  lockedUntil: string | null;
}

const b64 = (buffer: Buffer) => buffer.toString('base64');
const fromB64 = (value: string) => Buffer.from(value, 'base64');

export async function ensureSystemSchema(db: DbClient): Promise<void> {
  await db.executeScript(SYSTEM_SCHEMA);
  // Google ile giriş: Google hesap kimliğinin anahtarlı özeti (düz metin kimlik saklanmaz)
  try {
    await db.query('SELECT google_sub_hash FROM users LIMIT 0');
  } catch {
    await db.executeScript('ALTER TABLE users ADD COLUMN google_sub_hash TEXT');
  }
  await db.executeScript('CREATE UNIQUE INDEX IF NOT EXISTS idx_users_google ON users(google_sub_hash) WHERE google_sub_hash IS NOT NULL');
}

export async function findUserByGoogleSub(db: DbClient, googleSubHash: string): Promise<UserRecord | null> {
  const row = await db.queryOne<UserRow>(`${SELECT_USER} WHERE google_sub_hash = ?`, [googleSubHash]);
  return row ? toRecord(row) : null;
}

export async function setGoogleSub(db: DbClient, id: string, googleSubHash: string | null): Promise<void> {
  await db.execute('UPDATE users SET google_sub_hash = ? WHERE id = ?', [googleSubHash, id]);
}

const SELECT_USER = `
  SELECT id, email_hash AS "emailHash", kdf_salt AS "kdfSalt", kdf_params AS "kdfParams",
         key_by_password AS "keyByPassword", recovery_salt AS "recoverySalt", key_by_recovery AS "keyByRecovery",
         failed_logins AS "failedLogins", locked_until AS "lockedUntil"
  FROM users`;

function toRecord(row: UserRow): UserRecord {
  return {
    id: row.id,
    emailHash: row.emailHash,
    kdfSalt: fromB64(row.kdfSalt),
    kdfParams: JSON.parse(row.kdfParams) as KdfParams,
    keyByPassword: fromB64(row.keyByPassword),
    recoverySalt: fromB64(row.recoverySalt),
    keyByRecovery: fromB64(row.keyByRecovery),
    failedLogins: row.failedLogins,
    lockedUntil: row.lockedUntil,
  };
}

export async function findUserByEmailHash(db: DbClient, emailHash: string): Promise<UserRecord | null> {
  const row = await db.queryOne<UserRow>(`${SELECT_USER} WHERE email_hash = ?`, [emailHash]);
  return row ? toRecord(row) : null;
}

export async function findUserById(db: DbClient, id: string): Promise<UserRecord | null> {
  const row = await db.queryOne<UserRow>(`${SELECT_USER} WHERE id = ?`, [id]);
  return row ? toRecord(row) : null;
}

export async function insertUser(db: DbClient, user: Omit<UserRecord, 'failedLogins' | 'lockedUntil'>): Promise<void> {
  await db.execute(
    `INSERT INTO users (id, email_hash, kdf_salt, kdf_params, key_by_password, recovery_salt, key_by_recovery, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      user.id,
      user.emailHash,
      b64(user.kdfSalt),
      JSON.stringify(user.kdfParams),
      b64(user.keyByPassword),
      b64(user.recoverySalt),
      b64(user.keyByRecovery),
      new Date().toISOString(),
    ],
  );
}

export async function updatePasswordKey(db: DbClient, id: string, kdfSalt: Buffer, kdfParams: KdfParams, keyByPassword: Buffer): Promise<void> {
  await db.execute('UPDATE users SET kdf_salt = ?, kdf_params = ?, key_by_password = ?, failed_logins = 0, locked_until = NULL WHERE id = ?', [
    b64(kdfSalt),
    JSON.stringify(kdfParams),
    b64(keyByPassword),
    id,
  ]);
}

export async function updateRecoveryKey(db: DbClient, id: string, recoverySalt: Buffer, keyByRecovery: Buffer): Promise<void> {
  await db.execute('UPDATE users SET recovery_salt = ?, key_by_recovery = ? WHERE id = ?', [b64(recoverySalt), b64(keyByRecovery), id]);
}

export async function recordFailedLogin(db: DbClient, id: string, failedLogins: number, lockedUntil: string | null): Promise<void> {
  await db.execute('UPDATE users SET failed_logins = ?, locked_until = ? WHERE id = ?', [failedLogins, lockedUntil, id]);
}

export async function clearFailedLogins(db: DbClient, id: string): Promise<void> {
  await db.execute('UPDATE users SET failed_logins = 0, locked_until = NULL WHERE id = ?', [id]);
}

export async function deleteUser(db: DbClient, id: string): Promise<void> {
  await db.execute('DELETE FROM users WHERE id = ?', [id]);
}

// ── Şifreli çalışma alanı dosyaları ──

const MAGIC = Buffer.from('CLARIO01', 'ascii');
const workspaceAad = (userId: string) => `workspace:${userId}`;

export function workspaceFile(dataDir: string, userId: string): string {
  return path.join(dataDir, 'users', `${userId}.clario`);
}

/** Veritabanı görüntüsünü şifreleyip dosyaya yazar. Önce geçici dosyaya yazılır; yarım kalan yazım eski dosyayı bozmaz. */
export function writeEncryptedWorkspace(file: string, userId: string, key: Buffer, snapshot: Uint8Array): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const payload = Buffer.concat([MAGIC, encrypt(key, snapshot, workspaceAad(userId))]);
  const temp = `${file}.${process.pid}.tmp`;
  const fd = fs.openSync(temp, 'w', 0o600);
  try {
    fs.writeSync(fd, payload);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(temp, file);
}

export function readEncryptedWorkspace(file: string, userId: string, key: Buffer): Buffer {
  const payload = fs.readFileSync(file);
  if (!payload.subarray(0, MAGIC.length).equals(MAGIC)) throw new Error(`Tanınmayan çalışma alanı dosyası: ${file}`);
  return decrypt(key, payload.subarray(MAGIC.length), workspaceAad(userId));
}

/** Sunucuya özgü gizli anahtar (e-posta özetleri için). İlk çalıştırmada oluşturulur. */
export function loadServerSecret(dataDir: string): Buffer {
  const file = path.join(dataDir, 'server.key');
  if (fs.existsSync(file)) return Buffer.from(fs.readFileSync(file, 'utf8').trim(), 'base64');
  fs.mkdirSync(dataDir, { recursive: true });
  const secret = randomKey();
  fs.writeFileSync(file, secret.toString('base64'), { mode: 0o600, flag: 'wx' });
  return secret;
}
