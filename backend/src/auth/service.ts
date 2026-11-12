import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import type { Request, Response } from 'express';
import { openSnapshotDatabase, type SnapshotDbClient } from '../db/index.js';
import { resetSchema } from '../db/schema.js';
import type { DbClient } from '../db/types.js';
import { COUNTRY_CODES, currencyForCountry, isCountry } from '../currency/countries.js';
import { HttpError } from '../http/errors.js';
import { setBaseCurrency } from '../repositories/settingsRepository.js';
import { setSetting } from '../repositories/settingsRepository.js';
import {
  DEFAULT_KDF,
  decrypt,
  DecryptionError,
  deriveKeyFromPassword,
  deriveKeyFromRecovery,
  encrypt,
  generateRecoveryKey,
  keyedHash,
  randomKey,
  randomSalt,
  randomToken,
  wipe,
} from '../security/crypto.js';
import { createWorkspaceRouter, PROFILE_KEYS, type Workspace, type WorkspaceServices } from '../workspace/router.js';
import { GoogleAuthError, type GoogleProvider } from './google.js';
import * as store from './store.js';

export const SESSION_COOKIE = 'clario_session';
/** Google'a giderken üretilen "state" (giriş CSRF'sine karşı tarayıcıya bağlanır) */
const OAUTH_COOKIE = 'clario_oauth';
/** Google doğruladı, veri parolası bekleniyor */
const GOOGLE_PENDING_COOKIE = 'clario_google';
const GOOGLE_STEP_MS = 10 * 60 * 1000;
/** İşlem yapılmazsa oturum bu süre sonunda kapanır ve veri yeniden kilitlenir */
const IDLE_TIMEOUT_MS = 12 * 60 * 60 * 1000;
/** Oturumun en uzun ömrü */
const ABSOLUTE_TIMEOUT_MS = 7 * 24 * 60 * 60 * 1000;
/** Kilit açıksa (lockoutMinutes > 0) art arda bu kadar hatalı denemede hesap kilitlenir */
const MAX_FAILED_LOGINS = 5;

export const PASSWORD_MIN_LENGTH = 10;
const COMMON_PASSWORDS = new Set(['1234567890', '0123456789', 'qwerty1234', 'password12', 'password123', 'parola1234', 'sifre12345', 'asdfgh1234']);
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

interface Session {
  userId: string;
  createdAt: number;
  lastSeen: number;
}

interface OpenWorkspace {
  workspace: Workspace;
  db: SnapshotDbClient;
  /** Veri anahtarı: yalnızca oturum açıkken bellekte durur */
  key: Buffer;
  file: string;
  sessions: Set<string>;
}

interface OAuthRequest {
  verifier: string;
  nonce: string;
  expiresAt: number;
}

/** Google kimliği doğrulandıktan sonra veri parolası beklenen adım */
interface GooglePending {
  kind: 'unlock' | 'link' | 'register';
  userId: string | null;
  email: string;
  name: string | null;
  googleSubHash: string;
  expiresAt: number;
}

export interface AuthOptions {
  dataDir: string;
  /** Google ile giriş (tanımlı değilse düğme gösterilmez) */
  google?: { provider: GoogleProvider; appUrl: string };
  services: WorkspaceServices;
  /** true: çerez yalnızca HTTPS'te gönderilir. 'auto': istek HTTPS ise */
  cookieSecure?: boolean | 'auto';
  /** Test: daha hızlı anahtar türetme */
  kdfParams?: typeof DEFAULT_KDF;
  /**
   * Hatalı denemelerden sonra hesabın kilitli kalacağı süre (dakika). 0: kilit kapalı (varsayılan).
   * Kapalıyken de her deneme scrypt nedeniyle ~0,3 sn sürer; kaba kuvvet yine yavaştır.
   */
  lockoutMinutes?: number;
  /**
   * Uygulama bir cihazın içinde çalışıyor (Android). Hesaplar o cihaza özeldir; giriş ekranı cihazda hiç hesap
   * olmadığını bilip kayıt ekranını açabilsin diye durum yanıtına hesap olup olmadığı eklenir. Sunucuda kapalıdır
   * (sunucuda hesap varlığı bilgisi verilmez).
   */
  device?: boolean;
}

export interface PublicUser {
  email: string;
  recoveryKey?: string;
}

function normalizeEmail(value: unknown): string {
  if (typeof value !== 'string') throw new HttpError(400, 'E-posta adresi gerekli.');
  const email = value.trim().toLowerCase();
  if (email.length > 254 || !EMAIL_PATTERN.test(email)) throw new HttpError(400, 'Geçerli bir e-posta adresi girin.');
  return email;
}

export function validateName(value: unknown): string {
  const name = typeof value === 'string' ? value.trim() : '';
  if (name.length < 2) throw new HttpError(400, 'Adınızı girin (en az 2 karakter).');
  return name.slice(0, 80);
}

export function validateCountry(value: unknown): string {
  if (!isCountry(value)) throw new HttpError(400, 'Ülkenizi seçin.');
  return value;
}

export function validatePassword(value: unknown): string {
  if (typeof value !== 'string') throw new HttpError(400, 'Parola gerekli.');
  if (value.length < PASSWORD_MIN_LENGTH) throw new HttpError(400, `Parola en az ${PASSWORD_MIN_LENGTH} karakter olmalı.`);
  if (value.length > 200) throw new HttpError(400, 'Parola en fazla 200 karakter olabilir.');
  if (!/\p{L}/u.test(value) || !/\d/.test(value)) throw new HttpError(400, 'Parola en az bir harf ve bir rakam içermeli.');
  if (COMMON_PASSWORDS.has(value.toLowerCase()) || /^(.)\1+$/.test(value)) throw new HttpError(400, 'Bu parola çok kolay tahmin edilir; başka bir parola seçin.');
  return value;
}

const INVALID_LOGIN = 'E-posta veya parola hatalı.';

/**
 * Hesaplar, oturumlar ve şifreli çalışma alanları.
 *
 * Anahtar hiyerarşisi: her hesabın rastgele bir veri anahtarı (DEK) vardır. Çalışma alanı dosyası bu anahtarla
 * AES-256-GCM ile şifrelenir. DEK iki kez sarılarak saklanır: parolada türetilen anahtarla ve kurtarma anahtarından
 * türetilen anahtarla. Sunucu DEK'i yalnızca giriş yapılmış bir oturum varken bellekte tutar; oturum kapanınca
 * veri diske şifreli yazılır ve anahtar bellekten silinir. Yani parola bilinmeden veri okunamaz.
 */
export class AuthService {
  private readonly sessions = new Map<string, Session>();
  private readonly open = new Map<string, OpenWorkspace>();
  private readonly secret: Buffer;
  private readonly kdf: typeof DEFAULT_KDF;
  private readonly sweeper: NodeJS.Timeout;
  private readonly oauthRequests = new Map<string, OAuthRequest>();
  private readonly googlePending = new Map<string, GooglePending>();

  constructor(
    private readonly system: DbClient,
    private readonly options: AuthOptions,
  ) {
    this.secret = store.loadServerSecret(options.dataDir);
    this.kdf = options.kdfParams ?? DEFAULT_KDF;
    this.sweeper = setInterval(() => void this.sweep(), 60_000);
    // Node'da süreç kapanışını engellemesin; telefondaki uygulamada (WebView) unref yoktur
    (this.sweeper as { unref?: () => void }).unref?.();
  }

  static async create(system: DbClient, options: AuthOptions): Promise<AuthService> {
    await store.ensureSystemSchema(system);
    return new AuthService(system, options);
  }

  // ── Oturum çözümleme ──

  /** Çerezdeki oturumun çalışma alanı; oturum yoksa veya süresi dolduysa null. */
  resolve = (req: Request): Workspace | null => {
    const token = readCookie(req, SESSION_COOKIE);
    if (!token) return null;
    const session = this.sessions.get(token);
    if (!session) return null;
    const now = Date.now();
    if (now - session.lastSeen > IDLE_TIMEOUT_MS || now - session.createdAt > ABSOLUTE_TIMEOUT_MS) {
      void this.endSession(token);
      return null;
    }
    session.lastSeen = now;
    return this.open.get(session.userId)?.workspace ?? null;
  };

  // ── Kayıt / giriş ──

  async status() {
    const device = this.options.device
      ? { device: true, hasAccounts: Boolean(await this.system.queryOne('SELECT 1 AS found FROM users LIMIT 1')) }
      : {};
    return {
      ...device,
      /** Kayıt formundaki ülke listesi: her ülke için verilerin para birimi olarak önerilen para birimi */
      countries: COUNTRY_CODES.map((code) => ({ code, ...currencyForCountry(code) })),
      googleEnabled: Boolean(this.options.google),
      /** Google girişi yalnızca bu adresten açıldığında çalışır (Google'a kayıtlı dönüş adresi) */
      googleAppUrl: this.options.google?.appUrl ?? null,
    };
  }

  async register(res: Response, req: Request, input: Record<string, unknown>): Promise<PublicUser> {
    const email = normalizeEmail(input.email);
    const name = validateName(input.name);
    const country = validateCountry(input.country);
    const password = validatePassword(input.password);
    return this.createAccount(res, req, { email, password, name, country, googleSubHash: null });
  }

  private async createAccount(
    res: Response,
    req: Request,
    input: { email: string; password: string; name: string; country: string; googleSubHash: string | null },
  ): Promise<PublicUser> {
    const { email, password, name } = input;
    const emailHash = keyedHash(this.secret, email);
    if (await store.findUserByEmailHash(this.system, emailHash)) throw new HttpError(409, 'Bu e-posta ile bir hesap zaten var. Giriş yapın.');


    const id = randomUUID();
    const key = randomKey();
    const kdfSalt = randomSalt();
    const recoverySalt = randomSalt();
    const recoveryKey = generateRecoveryKey();
    const passwordKey = await deriveKeyFromPassword(password, kdfSalt, this.kdf);
    const keyByPassword = encrypt(passwordKey, key, `user:${id}:password`);
    const keyByRecovery = encrypt(deriveKeyFromRecovery(recoveryKey, recoverySalt), key, `user:${id}:recovery`);
    wipe(passwordKey);

    // Yeni hesap her zaman boş başlar (örnek/demo veri yok)
    const db = await openSnapshotDatabase();
    await setSetting(db, PROFILE_KEYS.email, email);
    await setSetting(db, PROFILE_KEYS.name, name);
    await setSetting(db, PROFILE_KEYS.country, input.country);
    // Verilerin para birimi ülkeden gelir (kurulumda veya Veri Yönetimi'nden değiştirilebilir)
    await setBaseCurrency(db, currencyForCountry(input.country).currency);
    if (input.googleSubHash) await setSetting(db, PROFILE_KEYS.google, 'true');
    const file = store.workspaceFile(this.options.dataDir, id);
    store.writeEncryptedWorkspace(file, id, key, db.serialize());
    db.markClean();
    await store.insertUser(this.system, { id, emailHash, kdfSalt, kdfParams: this.kdf, keyByPassword, recoverySalt, keyByRecovery });
    if (input.googleSubHash) await store.setGoogleSub(this.system, id, input.googleSubHash);

    this.attach(id, db, key, file);
    this.startSession(res, req, id);
    return { email, recoveryKey };
  }

  async login(res: Response, req: Request, input: Record<string, unknown>): Promise<PublicUser> {
    const email = normalizeEmail(input.email);
    const password = typeof input.password === 'string' ? input.password : '';
    const user = await store.findUserByEmailHash(this.system, keyedHash(this.secret, email));
    if (!user) {
      // Hesap olmasa da aynı süre harcanır: yanıt süresinden e-postanın kayıtlı olup olmadığı anlaşılmasın
      await deriveKeyFromPassword(password, randomSalt(), this.kdf);
      throw new HttpError(401, INVALID_LOGIN);
    }
    const key = await this.unlockWithPassword(user, password, INVALID_LOGIN);
    await this.openWorkspace(user.id, key);
    this.startSession(res, req, user.id);
    return { email };
  }

  /** Parolayla veri anahtarını açar; hatalı denemeleri sayar ve gerekirse hesabı kilitler. */
  private async unlockWithPassword(user: store.UserRecord, password: string, invalidMessage: string): Promise<Buffer> {
    this.assertNotLocked(user);
    const key = await this.unwrapWithPassword(user, password);
    if (!key) {
      const failed = user.failedLogins + 1;
      const lockedUntil = this.lockUntil(failed);
      await store.recordFailedLogin(this.system, user.id, lockedUntil ? 0 : failed, lockedUntil);
      if (lockedUntil) throw new HttpError(429, `Çok fazla hatalı deneme. Hesap ${this.lockoutMinutes} dakika kilitlendi.`);
      throw new HttpError(401, invalidMessage);
    }
    await store.clearFailedLogins(this.system, user.id);
    return key;
  }

  // ── Google ile giriş ──

  private get google() {
    if (!this.options.google) throw new HttpError(404, 'Google ile giriş bu kurulumda etkin değil.');
    return this.options.google;
  }

  /** Google'a yönlendirme adresi; state tarayıcıya çerezle bağlanır (başkasının girişine sürüklenmeyi önler). */
  googleStart(req: Request, res: Response): string {
    const request = this.google.provider.createAuthRequest();
    const now = Date.now();
    for (const [state, entry] of this.oauthRequests) if (entry.expiresAt < now) this.oauthRequests.delete(state);
    this.oauthRequests.set(request.state, { verifier: request.verifier, nonce: request.nonce, expiresAt: now + GOOGLE_STEP_MS });
    // Google'dan dönüş siteler arası bir yönlendirme olduğu için bu çerez SameSite=Lax olmalı
    res.append('Set-Cookie', flowCookie(OAUTH_COOKIE, request.state, GOOGLE_STEP_MS / 1000, this.isSecure(req)));
    return request.url;
  }

  /** Google'dan dönüş. Her durumda arayüze yönlendirilir; hata varsa ?googleError=… ile. */
  async googleCallback(req: Request, res: Response): Promise<string> {
    const { appUrl, provider } = this.google;
    res.append('Set-Cookie', flowCookie(OAUTH_COOKIE, '', 0, this.isSecure(req)));
    try {
      if (req.query.error) throw new GoogleAuthError('denied', 'Google girişi iptal edildi.');
      const state = typeof req.query.state === 'string' ? req.query.state : '';
      const code = typeof req.query.code === 'string' ? req.query.code : '';
      const request = this.oauthRequests.get(state);
      this.oauthRequests.delete(state);
      if (!state || !code || !request || request.expiresAt < Date.now() || readCookie(req, OAUTH_COOKIE) !== state) {
        throw new GoogleAuthError('state', 'Google girişinin süresi doldu veya başka bir pencerede başlatıldı. Tekrar deneyin.');
      }
      const claims = await provider.exchangeCode(code, request.verifier, request.nonce);
      const googleSubHash = keyedHash(this.secret, `google:${claims.sub}`);
      const linked = await store.findUserByGoogleSub(this.system, googleSubHash);
      const byEmail = linked ? null : await store.findUserByEmailHash(this.system, keyedHash(this.secret, claims.email));
      const pending: GooglePending = {
        kind: linked ? 'unlock' : byEmail ? 'link' : 'register',
        userId: linked?.id ?? byEmail?.id ?? null,
        email: claims.email,
        name: claims.name,
        googleSubHash,
        expiresAt: Date.now() + GOOGLE_STEP_MS,
      };
      const ticket = randomToken();
      this.googlePending.set(ticket, pending);
      res.append('Set-Cookie', flowCookie(GOOGLE_PENDING_COOKIE, ticket, GOOGLE_STEP_MS / 1000, this.isSecure(req)));
      return `${appUrl}/`;
    } catch (error) {
      const code = error instanceof GoogleAuthError ? error.code : 'failed';
      if (!(error instanceof GoogleAuthError)) console.error('[google] Giriş tamamlanamadı:', error);
      return `${appUrl}/?googleError=${code}`;
    }
  }

  private pendingFor(req: Request): [string, GooglePending] | null {
    const ticket = readCookie(req, GOOGLE_PENDING_COOKIE);
    const pending = ticket ? this.googlePending.get(ticket) : undefined;
    if (!ticket || !pending) return null;
    if (pending.expiresAt < Date.now()) {
      this.googlePending.delete(ticket);
      return null;
    }
    return [ticket, pending];
  }

  /** Google doğrulandıysa hangi adımın beklendiği (arayüz buna göre veri parolası ister). */
  googleStatus(req: Request) {
    const entry = this.pendingFor(req);
    return entry ? { kind: entry[1].kind, email: entry[1].email, name: entry[1].name } : null;
  }

  /**
   * Google'dan sonraki adım: veri parolası.
   *  - unlock: Google'a bağlı hesap → parola veriyi açar
   *  - link: aynı e-postayla açılmış hesap → mevcut parolayla doğrulanır ve Google bağlanır
   *  - register: yeni hesap → veri parolası belirlenir (kurtarma anahtarı döner)
   */
  async googleComplete(req: Request, res: Response, input: Record<string, unknown>): Promise<PublicUser> {
    const entry = this.pendingFor(req);
    if (!entry) throw new HttpError(401, 'Google girişinin süresi doldu. Lütfen tekrar "Google ile devam et"e tıklayın.');
    const [ticket, pending] = entry;
    const password = typeof input.password === 'string' ? input.password : '';

    let result: PublicUser;
    if (pending.kind === 'register') {
      result = await this.createAccount(res, req, {
        email: pending.email,
        name: validateName(typeof input.name === 'string' && input.name.trim() ? input.name : pending.name),
        country: validateCountry(input.country),
        password: validatePassword(password),
        googleSubHash: pending.googleSubHash,
      });
    } else {
      const user = await store.findUserById(this.system, pending.userId!);
      if (!user) throw new HttpError(401, 'Hesap bulunamadı.');
      const key = await this.unlockWithPassword(user, password, pending.kind === 'link' ? 'Parola hatalı.' : 'Veri parolası hatalı.');
      if (pending.kind === 'link') await store.setGoogleSub(this.system, user.id, pending.googleSubHash);
      await this.openWorkspace(user.id, key);
      if (pending.kind === 'link') await setSetting(this.open.get(user.id)!.db, PROFILE_KEYS.google, 'true');
      this.startSession(res, req, user.id);
      result = { email: pending.email };
    }
    this.googlePending.delete(ticket);
    res.append('Set-Cookie', flowCookie(GOOGLE_PENDING_COOKIE, '', 0, this.isSecure(req)));
    return result;
  }

  googleCancel(req: Request, res: Response): void {
    const entry = this.pendingFor(req);
    if (entry) this.googlePending.delete(entry[0]);
    res.append('Set-Cookie', flowCookie(GOOGLE_PENDING_COOKIE, '', 0, this.isSecure(req)));
  }

  /** Google bağlantısını kaldırır; hesap e-posta ve parolayla kullanılmaya devam eder. */
  async googleUnlink(req: Request): Promise<void> {
    const { user } = await this.currentUser(req);
    await store.setGoogleSub(this.system, user.id, null);
    const entry = this.open.get(user.id);
    if (entry) await setSetting(entry.db, PROFILE_KEYS.google, 'false');
  }

  /** Parola unutulduysa: kurtarma anahtarıyla veri anahtarını çöz, yeni parolayla yeniden sar. */
  async recover(res: Response, req: Request, input: Record<string, unknown>): Promise<PublicUser> {
    const email = normalizeEmail(input.email);
    const newPassword = validatePassword(input.newPassword);
    const recoveryKey = typeof input.recoveryKey === 'string' ? input.recoveryKey : '';
    const user = await store.findUserByEmailHash(this.system, keyedHash(this.secret, email));
    const invalid = new HttpError(401, 'E-posta veya kurtarma anahtarı hatalı.');
    if (!user) throw invalid;
    this.assertNotLocked(user);

    let key: Buffer;
    try {
      key = decrypt(deriveKeyFromRecovery(recoveryKey, user.recoverySalt), user.keyByRecovery, `user:${user.id}:recovery`);
    } catch (error) {
      if (!(error instanceof DecryptionError)) throw error;
      const failed = user.failedLogins + 1;
      const lockedUntil = this.lockUntil(failed);
      await store.recordFailedLogin(this.system, user.id, lockedUntil ? 0 : failed, lockedUntil);
      throw invalid;
    }
    await this.setPassword(user.id, key, newPassword);
    this.endUserSessions(user.id);
    await this.openWorkspace(user.id, key);
    this.startSession(res, req, user.id);
    return { email };
  }

  async logout(req: Request, res: Response): Promise<void> {
    const token = readCookie(req, SESSION_COOKIE);
    if (token) await this.endSession(token);
    clearSessionCookie(res, this.isSecure(req));
  }

  // ── Oturum açıkken hesap işlemleri ──

  private async currentUser(req: Request) {
    const token = readCookie(req, SESSION_COOKIE);
    const session = token ? this.sessions.get(token) : undefined;
    if (!token || !session || !this.resolve(req)) throw new HttpError(401, 'Oturum açmanız gerekiyor.');
    const user = await store.findUserById(this.system, session.userId);
    if (!user) throw new HttpError(401, 'Hesap bulunamadı.');
    return { user, token };
  }

  async changePassword(req: Request, input: Record<string, unknown>): Promise<void> {
    const { user, token } = await this.currentUser(req);
    const newPassword = validatePassword(input.newPassword);
    const key = await this.unwrapWithPassword(user, typeof input.currentPassword === 'string' ? input.currentPassword : '');
    if (!key) throw new HttpError(401, 'Mevcut parola hatalı.');
    await this.setPassword(user.id, key, newPassword);
    wipe(key);
    // Diğer cihazlardaki oturumlar kapanır; bu oturum açık kalır
    this.endUserSessions(user.id, token);
  }

  async newRecoveryKey(req: Request, input: Record<string, unknown>): Promise<string> {
    const { user } = await this.currentUser(req);
    const key = await this.unwrapWithPassword(user, typeof input.password === 'string' ? input.password : '');
    if (!key) throw new HttpError(401, 'Parola hatalı.');
    const recoveryKey = generateRecoveryKey();
    const salt = randomSalt();
    await store.updateRecoveryKey(this.system, user.id, salt, encrypt(deriveKeyFromRecovery(recoveryKey, salt), key, `user:${user.id}:recovery`));
    wipe(key);
    return recoveryKey;
  }

  /**
   * İşletme verilerini (satış, ürün, müşteri, stok, gider, bölge, çalışan) siler; hesap, profil, para birimi ve
   * yapay zekâ bağlantısı korunur. Yanlışlıkla yapılmasın diye parola istenir.
   */
  async resetData(req: Request, input: Record<string, unknown>): Promise<void> {
    const { user } = await this.currentUser(req);
    const key = await this.unwrapWithPassword(user, typeof input.password === 'string' ? input.password : '');
    if (!key) throw new HttpError(401, 'Parola hatalı.');
    wipe(key);
    const entry = this.open.get(user.id);
    if (!entry) throw new HttpError(401, 'Oturum açmanız gerekiyor.');
    await resetSchema(entry.db);
    this.persist(entry);
  }

  /** Hesabı ve tüm verisini kalıcı olarak siler. */
  async deleteAccount(req: Request, res: Response, input: Record<string, unknown>): Promise<void> {
    const { user } = await this.currentUser(req);
    const key = await this.unwrapWithPassword(user, typeof input.password === 'string' ? input.password : '');
    if (!key) throw new HttpError(401, 'Parola hatalı.');
    wipe(key);
    const open = this.open.get(user.id);
    this.endUserSessions(user.id);
    if (open) {
      this.open.delete(user.id);
      await open.db.close();
      wipe(open.key);
    }
    fs.rmSync(store.workspaceFile(this.options.dataDir, user.id), { force: true });
    await store.deleteUser(this.system, user.id);
    clearSessionCookie(res, this.isSecure(req));
  }

  /** Tüm açık çalışma alanlarını diske yazar ve kapatır (sunucu kapanırken). */
  async closeAll(): Promise<void> {
    clearInterval(this.sweeper);
    for (const userId of [...this.open.keys()]) await this.closeWorkspace(userId);
    this.sessions.clear();
  }

  // ── İç işleyiş ──

  private get lockoutMinutes(): number {
    return this.options.lockoutMinutes ?? 0;
  }

  /** Bu kadar hatalı denemeden sonra kilit bitiş zamanı; kilit kapalıysa veya sınır aşılmadıysa null */
  private lockUntil(failed: number): string | null {
    if (this.lockoutMinutes <= 0 || failed < MAX_FAILED_LOGINS) return null;
    return new Date(Date.now() + this.lockoutMinutes * 60_000).toISOString();
  }

  private assertNotLocked(user: store.UserRecord): void {
    // Kilit kapalıysa daha önce konmuş kilitler de geçerli sayılmaz
    if (this.lockoutMinutes > 0 && user.lockedUntil && Date.parse(user.lockedUntil) > Date.now()) {
      throw new HttpError(429, `Çok fazla hatalı deneme. Lütfen ${this.lockoutMinutes} dakika sonra tekrar deneyin.`);
    }
  }

  private async unwrapWithPassword(user: store.UserRecord, password: string): Promise<Buffer | null> {
    const passwordKey = await deriveKeyFromPassword(password, user.kdfSalt, user.kdfParams);
    try {
      return decrypt(passwordKey, user.keyByPassword, `user:${user.id}:password`);
    } catch (error) {
      if (error instanceof DecryptionError) return null;
      throw error;
    } finally {
      wipe(passwordKey);
    }
  }

  private async setPassword(userId: string, key: Buffer, password: string): Promise<void> {
    const salt = randomSalt();
    const passwordKey = await deriveKeyFromPassword(password, salt, this.kdf);
    await store.updatePasswordKey(this.system, userId, salt, this.kdf, encrypt(passwordKey, key, `user:${userId}:password`));
    wipe(passwordKey);
  }

  private async openWorkspace(userId: string, key: Buffer): Promise<void> {
    if (this.open.has(userId)) {
      wipe(key); // zaten açık (başka cihazdan giriş): aynı çalışma alanı paylaşılır
      return;
    }
    const file = store.workspaceFile(this.options.dataDir, userId);
    let snapshot: Buffer;
    try {
      snapshot = store.readEncryptedWorkspace(file, userId, key);
    } catch (error) {
      wipe(key);
      console.error(`[${new Date().toISOString()}] Çalışma alanı açılamadı (${userId}):`, error);
      throw new HttpError(500, 'Hesabınızın şifreli veri dosyası açılamadı: dosya bozulmuş veya değiştirilmiş olabilir.');
    }
    const db = await openSnapshotDatabase(snapshot);
    this.attach(userId, db, key, file);
  }

  private attach(userId: string, db: SnapshotDbClient, key: Buffer, file: string): void {
    const entry: OpenWorkspace = {
      db,
      key,
      file,
      sessions: new Set(),
      workspace: {
        id: userId,
        db,
        router: createWorkspaceRouter(db, this.options.services),
        // Her istekten sonra değişiklik varsa şifreli dosyaya yazılır
        afterRequest: () => this.persist(entry),
      },
    };
    this.open.set(userId, entry);
  }

  private persist(entry: OpenWorkspace): void {
    if (!entry.db.isDirty()) return;
    try {
      store.writeEncryptedWorkspace(entry.file, entry.workspace.id, entry.key, entry.db.serialize());
      entry.db.markClean();
    } catch (error) {
      console.error(`[${new Date().toISOString()}] Çalışma alanı kaydedilemedi (${entry.workspace.id}):`, error);
    }
  }

  private startSession(res: Response, req: Request, userId: string): void {
    const token = randomToken();
    const now = Date.now();
    this.sessions.set(token, { userId, createdAt: now, lastSeen: now });
    this.open.get(userId)!.sessions.add(token);
    res.append('Set-Cookie', sessionCookie(token, ABSOLUTE_TIMEOUT_MS / 1000, this.isSecure(req)));
  }

  private async endSession(token: string): Promise<void> {
    const session = this.sessions.get(token);
    this.sessions.delete(token);
    if (!session) return;
    const entry = this.open.get(session.userId);
    entry?.sessions.delete(token);
    if (entry && entry.sessions.size === 0) await this.closeWorkspace(session.userId);
  }

  private endUserSessions(userId: string, except?: string): void {
    for (const [token, session] of this.sessions) {
      if (session.userId === userId && token !== except) {
        this.sessions.delete(token);
        this.open.get(userId)?.sessions.delete(token);
      }
    }
  }

  /** Son oturum kapanınca: veriyi şifreli yaz, belleği boşalt, anahtarı sil. */
  private async closeWorkspace(userId: string): Promise<void> {
    const entry = this.open.get(userId);
    if (!entry) return;
    this.persist(entry);
    this.open.delete(userId);
    await entry.db.close();
    wipe(entry.key);
  }

  private async sweep(): Promise<void> {
    const now = Date.now();
    for (const [token, session] of this.sessions) {
      if (now - session.lastSeen > IDLE_TIMEOUT_MS || now - session.createdAt > ABSOLUTE_TIMEOUT_MS) await this.endSession(token);
    }
    for (const entry of this.open.values()) this.persist(entry);
  }

  private isSecure(req: Request): boolean {
    const setting = this.options.cookieSecure ?? 'auto';
    return setting === 'auto' ? req.secure : setting;
  }
}

// ── Çerezler ──

function sessionCookie(token: string, maxAgeSeconds: number, secure: boolean): string {
  // HttpOnly: JavaScript okuyamaz (XSS ile çalınamaz). SameSite=Strict: başka sitelerden gelen isteklere eklenmez.
  return `${SESSION_COOKIE}=${token}; HttpOnly; SameSite=Strict; Path=/api; Max-Age=${maxAgeSeconds}${secure ? '; Secure' : ''}`;
}

function clearSessionCookie(res: Response, secure: boolean): void {
  res.append('Set-Cookie', sessionCookie('', 0, secure));
}

/**
 * Google akışı çerezleri: Google'dan dönüş siteler arası üst düzey bir yönlendirme olduğu için SameSite=Lax
 * (Strict olsaydı dönüşte gönderilmezdi). Kısa ömürlüdür ve tek başına oturum açmaz.
 */
function flowCookie(name: string, value: string, maxAgeSeconds: number, secure: boolean): string {
  return `${name}=${value}; HttpOnly; SameSite=Lax; Path=/api; Max-Age=${maxAgeSeconds}${secure ? '; Secure' : ''}`;
}

export function readCookie(req: Request, name: string): string | null {
  const header = req.headers.cookie;
  if (!header) return null;
  for (const part of header.split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) {
      const value = rest.join('=');
      return /^[A-Za-z0-9_-]{20,100}$/.test(value) ? value : null;
    }
  }
  return null;
}
