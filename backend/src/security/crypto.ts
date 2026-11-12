import { createCipheriv, createDecipheriv, createHmac, hkdfSync, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';

/**
 * Şifreleme yapı taşları (yalnızca Node'un yerleşik crypto modülü):
 *  - Parola → anahtar: scrypt (N=2^17, r=8, p=1; OWASP önerisi). Yavaş olması kaba kuvvet denemelerini pahalılaştırır.
 *  - Şifreleme: AES-256-GCM. Her şifrelemede rastgele 12 baytlık IV; kimlik doğrulama etiketi (tag) sayesinde
 *    değiştirilmiş veya yanlış anahtarla açılmaya çalışılan veri reddedilir.
 *  - Kurtarma anahtarı: 160 bit rastgele değer; zaten yüksek entropili olduğu için HKDF ile anahtara çevrilir.
 */

const KEY_BYTES = 32;
const IV_BYTES = 12;
const TAG_BYTES = 16;
export const SALT_BYTES = 16;

export interface KdfParams {
  N: number;
  r: number;
  p: number;
}

export const DEFAULT_KDF: KdfParams = { N: 2 ** 17, r: 8, p: 1 };

export function randomKey(): Buffer {
  return randomBytes(KEY_BYTES);
}

export function randomSalt(): Buffer {
  return randomBytes(SALT_BYTES);
}

/** Paroladan 256 bitlik anahtar türetir (≈0,3 sn; bilinçli olarak yavaş). */
export function deriveKeyFromPassword(password: string, salt: Buffer, params: KdfParams = DEFAULT_KDF): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password.normalize('NFKC'), salt, KEY_BYTES, { ...params, maxmem: 256 * params.N * params.r }, (error, key) =>
      error ? reject(error) : resolve(key),
    );
  });
}

/** AES-256-GCM: çıktı = IV ‖ tag ‖ şifreli metin. aad, verinin hangi bağlama ait olduğunu bağlar (ör. kullanıcı kimliği). */
export function encrypt(key: Buffer, plaintext: Uint8Array, aad: string): Buffer {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from(aad, 'utf8'));
  const body = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), body]);
}

export class DecryptionError extends Error {
  constructor() {
    super('Veri çözülemedi: anahtar yanlış veya veri bozulmuş.');
    this.name = 'DecryptionError';
  }
}

export function decrypt(key: Buffer, payload: Uint8Array, aad: string): Buffer {
  const data = Buffer.from(payload.buffer, payload.byteOffset, payload.byteLength);
  if (data.length < IV_BYTES + TAG_BYTES) throw new DecryptionError();
  try {
    const decipher = createDecipheriv('aes-256-gcm', key, data.subarray(0, IV_BYTES));
    decipher.setAAD(Buffer.from(aad, 'utf8'));
    decipher.setAuthTag(data.subarray(IV_BYTES, IV_BYTES + TAG_BYTES));
    return Buffer.concat([decipher.update(data.subarray(IV_BYTES + TAG_BYTES)), decipher.final()]);
  } catch {
    throw new DecryptionError();
  }
}

// ── Kurtarma anahtarı ──

/** Karıştırılabilecek karakterler (0/O, 1/I/L) yok: elle yazarken hata yapılmasın */
const RECOVERY_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const RECOVERY_LENGTH = 32;

/** "ABCD-EFGH-…" biçiminde, ~157 bit entropili kurtarma anahtarı. */
export function generateRecoveryKey(): string {
  const bytes = randomBytes(RECOVERY_LENGTH * 2);
  let key = '';
  // Reddetme örneklemesi: modülo sapması olmadan eşit dağılım
  for (let i = 0; key.length < RECOVERY_LENGTH; i++) {
    if (i >= bytes.length) return generateRecoveryKey();
    const value = bytes[i]!;
    if (value < 256 - (256 % RECOVERY_ALPHABET.length)) key += RECOVERY_ALPHABET[value % RECOVERY_ALPHABET.length];
  }
  return key.match(/.{4}/g)!.join('-');
}

/** Kullanıcının yazdığı anahtarı sadeleştirir: boşluk/tire yok sayılır, küçük harf kabul edilir. */
export function normalizeRecoveryKey(input: string): string {
  return input.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

export function deriveKeyFromRecovery(recoveryKey: string, salt: Buffer): Buffer {
  return Buffer.from(hkdfSync('sha256', normalizeRecoveryKey(recoveryKey), salt, 'clario-recovery-v1', KEY_BYTES));
}

// ── Yardımcılar ──

/** Anahtarlı özet: e-postayı düz metin saklamadan hesap bulmak için. */
export function keyedHash(secret: Buffer, value: string): string {
  return createHmac('sha256', secret).update(value, 'utf8').digest('hex');
}

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

export function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

/** Bellekteki anahtarı sıfırlar (oturum kapanınca). */
export function wipe(buffer: Buffer | null | undefined): void {
  buffer?.fill(0);
}
