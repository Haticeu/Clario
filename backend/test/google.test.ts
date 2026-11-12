import assert from 'node:assert/strict';
import fs from 'node:fs';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, it } from 'node:test';
import { createApp } from '../src/app.js';
import { createHash } from 'node:crypto';
import { createGoogleProvider, GoogleAuthError, type GoogleClaims, type GoogleProvider } from '../src/auth/google.js';
import { AuthService } from '../src/auth/service.js';
import type { RateProvider } from '../src/currency/rates.js';
import { createSqliteClient } from '../src/db/sqlite.js';
import { createAuthRouter } from '../src/http/authRoutes.js';
import { createNewsService } from '../src/news/service.js';
import './helpers.js';

const noRates: RateProvider = { source: 'yok', fetchRates: () => Promise.reject(new Error('ağ yok')) };
const APP_URL = 'http://localhost:5173';
const DATA_PASSWORD = 'Veri-parolam-2026';

/** Sahte Google: dönüş kodu hangi hesabı temsil ediyorsa onun kimliğini verir. */
function fakeGoogle(accounts: Record<string, GoogleClaims>): GoogleProvider {
  let n = 0;
  return {
    createAuthRequest() {
      const state = `state-${++n}-${'x'.repeat(24)}`;
      return { url: `https://accounts.example/auth?state=${state}`, state, verifier: 'v', nonce: 'n' };
    },
    async exchangeCode(code) {
      const claims = accounts[code];
      if (!claims) throw new GoogleAuthError('failed', 'Geçersiz kod');
      return claims;
    },
  };
}

const cleanups: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  while (cleanups.length) await cleanups.pop()!();
});

async function startApp() {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'clario-google-'));
  const system = createSqliteClient(path.join(dataDir, 'system.db'));
  const auth = await AuthService.create(system, {
    dataDir,
    kdfParams: { N: 2 ** 10, r: 8, p: 1 },
    services: { rates: noRates, news: createNewsService({ fetchFeed: async () => [], rates: noRates }) },
    google: {
      appUrl: APP_URL,
      provider: fakeGoogle({
        ayse: { sub: '1111-google-id', email: 'ayse@gmail.com', name: 'Ayşe Yılmaz' },
        mehmet: { sub: '2222-google-id', email: 'mehmet@ornek.com', name: 'Mehmet' },
      }),
    },
  });
  const server = createApp({ workspaces: auth.resolve, authRouter: createAuthRouter(auth) }).listen(0);
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
  cleanups.push(async () => {
    server.close();
    await auth.closeAll();
    await system.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });
  return { base, dataDir };
}

/** Tarayıcı gibi çerez saklayan istemci (yönlendirmeleri izlemez; Location başlığı okunur). */
function browser(base: string) {
  const jar = new Map<string, string>();
  const request = async (method: string, route: string, body?: unknown) => {
    const response = await fetch(base + route, {
      method,
      redirect: 'manual',
      headers: {
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        Cookie: [...jar].map(([k, v]) => `${k}=${v}`).join('; '),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    for (const cookie of response.headers.getSetCookie()) {
      const [pair] = cookie.split(';');
      const [name, value] = pair!.split('=');
      if (value) jar.set(name!, value);
      else jar.delete(name!);
    }
    return response;
  };
  return {
    request,
    get: (route: string) => request('GET', route),
    post: (route: string, body: unknown = {}) => request('POST', route, body),
    /** Google'a git, verilen hesapla dön */
    async googleLogin(code: string) {
      const start = await request('GET', '/auth/google/start');
      assert.equal(start.status, 302);
      const state = new URL(start.headers.get('location')!).searchParams.get('state')!;
      const callback = await request('GET', `/auth/google/callback?state=${state}&code=${code}`);
      return callback.headers.get('location');
    },
    async pending() {
      return ((await (await request('GET', '/auth/google/pending')).json()) as { pending: { kind: string; email: string } | null }).pending;
    },
    jar,
  };
}

describe('Google ile giriş', () => {
  it('ilk giriş: Google doğrular, veri parolası belirlenir, hesap açılır', async () => {
    const { base, dataDir } = await startApp();
    const status = (await (await fetch(`${base}/auth/status`)).json()) as { googleEnabled: boolean; googleAppUrl: string };
    assert.deepEqual([status.googleEnabled, status.googleAppUrl], [true, APP_URL]);

    const user = browser(base);
    const start = await user.get('/auth/google/start');
    assert.match(start.headers.getSetCookie()[0]!, /clario_oauth=.*HttpOnly; SameSite=Lax/);
    const state = new URL(start.headers.get('location')!).searchParams.get('state')!;
    assert.equal((await user.get(`/auth/google/callback?state=${state}&code=ayse`)).headers.get('location'), `${APP_URL}/`);

    assert.deepEqual(await user.pending(), { kind: 'register', email: 'ayse@gmail.com', name: 'Ayşe Yılmaz' });
    // Google doğrulaması tek başına oturum açmaz
    assert.equal((await user.get('/me')).status, 401);
    assert.equal((await user.post('/auth/google/complete', { password: '123456', country: 'TR' })).status, 400, 'kısa PIN kabul edilmez');
    assert.equal((await user.post('/auth/google/complete', { password: DATA_PASSWORD })).status, 400, 'ülke zorunlu');

    const done = await user.post('/auth/google/complete', { password: DATA_PASSWORD, country: 'TR' });
    assert.equal(done.status, 200);
    const { recoveryKey } = (await done.json()) as { recoveryKey: string };
    assert.match(recoveryKey, /^([A-Z2-9]{4}-){7}[A-Z2-9]{4}$/);
    const me = (await (await user.get('/me')).json()) as { email: string; name: string; googleLinked: boolean };
    assert.deepEqual([me.email, me.name, me.googleLinked], ['ayse@gmail.com', 'Ayşe Yılmaz', true]);
    assert.equal(await user.pending(), null);

    // Google hesap kimliği ve e-posta hiçbir dosyada düz metin değil
    for (const file of [path.join(dataDir, 'system.db'), ...fs.readdirSync(path.join(dataDir, 'users')).map((f) => path.join(dataDir, 'users', f))]) {
      const bytes = fs.readFileSync(file);
      assert.equal(bytes.includes(Buffer.from('1111-google-id')), false);
      assert.equal(bytes.includes(Buffer.from('ayse@gmail.com')), false);
    }
  });

  it('sonraki girişler: Google + veri parolası; yanlış parola veriyi açmaz; aynı parola e-postayla da çalışır', async () => {
    const { base } = await startApp();
    const first = browser(base);
    await first.googleLogin('ayse');
    await first.post('/auth/google/complete', { password: DATA_PASSWORD, country: 'TR' });
    await first.post('/data/regions', { name: 'Google Bölgesi' });
    await first.post('/auth/logout');

    const again = browser(base);
    await again.googleLogin('ayse');
    assert.equal((await again.pending())?.kind, 'unlock');
    const wrong = await again.post('/auth/google/complete', { password: 'Yanlis-parola-1' });
    assert.equal(wrong.status, 401);
    assert.match(((await wrong.json()) as { error: { message: string } }).error.message, /Veri parolası hatalı/);
    assert.equal((await again.post('/auth/google/complete', { password: DATA_PASSWORD })).status, 200);
    const regions = (await (await again.get('/data/regions')).json()) as { items: { name: string }[] };
    assert.deepEqual(regions.items.map((r) => r.name), ['Google Bölgesi']);

    // Google'ın çalışmadığı yerde (ör. yerel ağdan) aynı hesap e-posta + veri parolasıyla açılır
    const lan = browser(base);
    assert.equal((await lan.post('/auth/login', { email: 'ayse@gmail.com', password: DATA_PASSWORD })).status, 200);
  });

  it('aynı e-postayla parolalı hesap varsa: mevcut parolayla doğrulanıp Google bağlanır', async () => {
    const { base } = await startApp();
    const owner = browser(base);
    assert.equal((await owner.post('/auth/register', { email: 'mehmet@ornek.com', name: 'Mehmet', country: 'TR', password: 'Mehmetin-parolasi-1' })).status, 201);
    await owner.post('/data/regions', { name: 'Mehmet Bölgesi' });
    await owner.post('/auth/logout');

    const viaGoogle = browser(base);
    await viaGoogle.googleLogin('mehmet');
    assert.equal((await viaGoogle.pending())?.kind, 'link');
    assert.equal((await viaGoogle.post('/auth/google/complete', { password: 'baska-parola-9' })).status, 401);
    assert.equal((await viaGoogle.post('/auth/google/complete', { password: 'Mehmetin-parolasi-1' })).status, 200);
    const regions = (await (await viaGoogle.get('/data/regions')).json()) as { items: { name: string }[] };
    assert.deepEqual(regions.items.map((r) => r.name), ['Mehmet Bölgesi'], 'yeni hesap açılmadı, mevcut hesap bağlandı');
    assert.equal(((await (await viaGoogle.get('/me')).json()) as { googleLinked: boolean }).googleLinked, true);

    await viaGoogle.post('/auth/logout');
    const next = browser(base);
    await next.googleLogin('mehmet');
    assert.equal((await next.pending())?.kind, 'unlock');

    // Bağlantı kaldırılınca Google girişi yeniden "bağla" adımına döner
    assert.equal((await next.post('/auth/google/complete', { password: 'Mehmetin-parolasi-1' })).status, 200);
    assert.equal((await next.post('/auth/google/unlink')).status, 204);
    assert.equal(((await (await next.get('/me')).json()) as { googleLinked: boolean }).googleLinked, false);
    const later = browser(base);
    await later.googleLogin('mehmet');
    assert.equal((await later.pending())?.kind, 'link');
  });

  it('giriş CSRF\'si ve hatalar: yanlış/başka tarayıcıdaki state, iptal ve geçersiz kod arayüze hata koduyla döner', async () => {
    const { base } = await startApp();
    const victim = browser(base);
    const attacker = browser(base);
    const start = await attacker.get('/auth/google/start');
    const state = new URL(start.headers.get('location')!).searchParams.get('state')!;
    // Saldırganın başlattığı akışın dönüş bağlantısı kurbanın tarayıcısında açılırsa reddedilir (state çerezi yok)
    assert.equal((await victim.get(`/auth/google/callback?state=${state}&code=ayse`)).headers.get('location'), `${APP_URL}/?googleError=state`);
    assert.equal(await victim.pending(), null);
    // Aynı state ikinci kez kullanılamaz
    assert.equal((await attacker.get(`/auth/google/callback?state=${state}&code=ayse`)).headers.get('location'), `${APP_URL}/?googleError=state`);

    const user = browser(base);
    await user.get('/auth/google/start');
    assert.equal((await user.get('/auth/google/callback?error=access_denied')).headers.get('location'), `${APP_URL}/?googleError=denied`);
    assert.equal(await user.googleLogin('bilinmeyen-kod'), `${APP_URL}/?googleError=failed`);
    assert.equal((await user.post('/auth/google/complete', { password: DATA_PASSWORD })).status, 401);
  });

  it('Google yapılandırılmamışsa düğme gösterilmez ve endpoint 404 döner', async () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'clario-nogoogle-'));
    const system = createSqliteClient(path.join(dataDir, 'system.db'));
    const auth = await AuthService.create(system, { dataDir, kdfParams: { N: 2 ** 10, r: 8, p: 1 }, services: { rates: noRates, news: createNewsService({ fetchFeed: async () => [], rates: noRates }) } });
    const server = createApp({ workspaces: auth.resolve, authRouter: createAuthRouter(auth) }).listen(0);
    await new Promise<void>((resolve) => server.once('listening', resolve));
    cleanups.push(async () => {
      server.close();
      await auth.closeAll();
      await system.close();
      fs.rmSync(dataDir, { recursive: true, force: true });
    });
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
    const status = (await (await fetch(`${base}/auth/status`)).json()) as { googleEnabled: boolean };
    assert.equal(status.googleEnabled, false);
    assert.equal((await fetch(`${base}/auth/google/start`, { redirect: 'manual' })).status, 404);
  });
});

describe('Google kimlik bilgisinin doğrulanması', () => {
  const config = { clientId: 'istemci-123', clientSecret: 'gizli', redirectUri: `${APP_URL}/api/auth/google/callback` };
  const token = (claims: Record<string, unknown>) =>
    `h.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.imza`;
  const valid = {
    iss: 'https://accounts.google.com',
    aud: 'istemci-123',
    exp: Math.floor(Date.now() / 1000) + 600,
    nonce: 'n1',
    sub: '42',
    email: 'Ayse@Gmail.com',
    email_verified: true,
    name: 'Ayşe',
  };

  async function exchange(claims: Record<string, unknown>) {
    const original = globalThis.fetch;
    let sentBody = '';
    globalThis.fetch = async (_url, init) => {
      sentBody = String(init?.body);
      return new Response(JSON.stringify({ id_token: token(claims) }), { status: 200 });
    };
    try {
      return { claims: await createGoogleProvider(config).exchangeCode('kod', 'dogrulayici', 'n1'), sentBody };
    } finally {
      globalThis.fetch = original;
    }
  }

  it('yönlendirme PKCE (S256), state ve nonce içerir', () => {
    const request = createGoogleProvider(config).createAuthRequest();
    const url = new URL(request.url);
    assert.equal(url.origin, 'https://accounts.google.com');
    assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
    assert.equal(url.searchParams.get('code_challenge'), createHash('sha256').update(request.verifier).digest('base64url'));
    assert.equal(url.searchParams.get('state'), request.state);
    assert.equal(url.searchParams.get('nonce'), request.nonce);
    assert.equal(url.searchParams.get('redirect_uri'), config.redirectUri);
  });

  it('geçerli kimlik kabul edilir; kod doğrulayıcıyla (PKCE) takas edilir', async () => {
    const { claims, sentBody } = await exchange(valid);
    assert.deepEqual(claims, { sub: '42', email: 'ayse@gmail.com', name: 'Ayşe' });
    assert.match(sentBody, /code_verifier=dogrulayici/);
  });

  it('başka uygulamaya verilmiş, süresi dolmuş, nonce uyuşmayan veya e-postası doğrulanmamış kimlik reddedilir', async () => {
    const cases: [Record<string, unknown>, string][] = [
      [{ ...valid, aud: 'baska-uygulama' }, 'failed'],
      [{ ...valid, iss: 'https://kotu.example' }, 'failed'],
      [{ ...valid, exp: Math.floor(Date.now() / 1000) - 10 }, 'failed'],
      [{ ...valid, nonce: 'baska' }, 'state'],
      [{ ...valid, email_verified: false }, 'unverified'],
    ];
    for (const [claims, code] of cases) {
      await assert.rejects(exchange(claims), (error: unknown) => error instanceof GoogleAuthError && error.code === code, JSON.stringify(claims));
    }
  });
});
