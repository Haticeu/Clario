import { createHash, randomBytes } from 'node:crypto';

/**
 * Google ile giriş (OpenID Connect, Authorization Code + PKCE). Ek kütüphane gerekmez.
 *
 * Kimliği Google doğrular; verinin kilidini ise kullanıcının veri parolası açar. Google parolanızı Clario
 * hiçbir zaman görmez, bu yüzden şifreleme anahtarı Google girişinden türetilemez.
 */

export interface GoogleClaims {
  /** Google hesabının değişmeyen kimliği */
  sub: string;
  email: string;
  name: string | null;
}

export interface GoogleAuthRequest {
  url: string;
  state: string;
  verifier: string;
  nonce: string;
}

/** Google ile konuşan kısım; testlerde sahtesi kullanılır. */
export interface GoogleProvider {
  /** Kullanıcının yönlendirileceği Google giriş adresi */
  createAuthRequest(): GoogleAuthRequest;
  /** Dönüş kodunu kimlik bilgisine çevirir; token ve iddialar doğrulanır */
  exchangeCode(code: string, verifier: string, nonce: string): Promise<GoogleClaims>;
}

export class GoogleAuthError extends Error {
  constructor(
    readonly code: 'denied' | 'state' | 'unverified' | 'failed',
    message: string,
  ) {
    super(message);
    this.name = 'GoogleAuthError';
  }
}

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const ISSUERS = new Set(['https://accounts.google.com', 'accounts.google.com']);

const base64url = (buffer: Buffer) => buffer.toString('base64url');

function decodeJwtPayload(token: string): Record<string, unknown> {
  const [, payload] = token.split('.');
  if (!payload) throw new GoogleAuthError('failed', 'Google kimlik bilgisi okunamadı.');
  return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as Record<string, unknown>;
}

export function createGoogleProvider(config: { clientId: string; clientSecret: string; redirectUri: string }): GoogleProvider {
  return {
    createAuthRequest() {
      const state = base64url(randomBytes(32));
      const nonce = base64url(randomBytes(32));
      const verifier = base64url(randomBytes(48));
      const challenge = base64url(createHash('sha256').update(verifier).digest());
      const params = new URLSearchParams({
        client_id: config.clientId,
        redirect_uri: config.redirectUri,
        response_type: 'code',
        scope: 'openid email profile',
        state,
        nonce,
        code_challenge: challenge,
        code_challenge_method: 'S256',
        prompt: 'select_account',
      });
      return { url: `${AUTH_URL}?${params}`, state, verifier, nonce };
    },

    async exchangeCode(code, verifier, nonce) {
      let response: Response;
      try {
        response = await fetch(TOKEN_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            code,
            client_id: config.clientId,
            client_secret: config.clientSecret,
            redirect_uri: config.redirectUri,
            grant_type: 'authorization_code',
            code_verifier: verifier,
          }),
          signal: AbortSignal.timeout(15_000),
        });
      } catch {
        throw new GoogleAuthError('failed', "Google'a ulaşılamadı. İnternet bağlantısını kontrol edin.");
      }
      const body = (await response.json().catch(() => ({}))) as { id_token?: string; error?: string };
      if (!response.ok || !body.id_token) {
        console.error('[google] Token alınamadı:', response.status, body.error);
        throw new GoogleAuthError('failed', 'Google girişi tamamlanamadı. Tekrar deneyin.');
      }

      // Token doğrudan Google'ın token adresinden (TLS ile, istemci sırrıyla) alındığı için imza yerine
      // TLS doğrulaması yeterlidir (OpenID Connect Core §3.1.3.7). İddialar yine de tek tek denetlenir.
      const claims = decodeJwtPayload(body.id_token);
      const now = Math.floor(Date.now() / 1000);
      if (!ISSUERS.has(String(claims.iss)) || claims.aud !== config.clientId || typeof claims.exp !== 'number' || claims.exp < now) {
        throw new GoogleAuthError('failed', 'Google kimlik bilgisi geçersiz.');
      }
      if (claims.nonce !== nonce) throw new GoogleAuthError('state', 'Google girişi doğrulanamadı. Tekrar deneyin.');
      if (claims.email_verified !== true || typeof claims.email !== 'string' || typeof claims.sub !== 'string') {
        throw new GoogleAuthError('unverified', 'Google hesabınızın e-posta adresi doğrulanmamış.');
      }
      return { sub: claims.sub, email: claims.email.toLowerCase(), name: typeof claims.name === 'string' ? claims.name : null };
    },
  };
}
