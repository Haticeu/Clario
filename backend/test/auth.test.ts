import assert from 'node:assert/strict';
import fs from 'node:fs';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, it } from 'node:test';
import { createApp } from '../src/app.js';
import { AuthService } from '../src/auth/service.js';
import type { RateProvider } from '../src/currency/rates.js';
import { createSqliteClient } from '../src/db/sqlite.js';
import { createAuthRouter } from '../src/http/authRoutes.js';
import { createNewsService } from '../src/news/service.js';
import './helpers.js';

const noRates: RateProvider = { source: 'yok', fetchRates: () => Promise.reject(new Error('ağ yok')) };
const PASSWORD = 'Guclu-parola-42';

const cleanups: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  while (cleanups.length) await cleanups.pop()!();
});

/** Gerçek hesap servisiyle, geçici klasörde çalışan uygulama (testte hızlı anahtar türetme). */
async function startApp(options: { lockoutMinutes?: number } = {}) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'clario-auth-'));
  const system = createSqliteClient(path.join(dataDir, 'system.db'));
  const auth = await AuthService.create(system, {
    dataDir,
    kdfParams: { N: 2 ** 10, r: 8, p: 1 },
    lockoutMinutes: options.lockoutMinutes,
    services: { rates: noRates, news: createNewsService({ fetchFeed: async () => [], rates: noRates }) },
  });
  const server = createApp({ workspaces: auth.resolve, authRouter: createAuthRouter(auth, { rateLimitMinutes: options.lockoutMinutes }) }).listen(0);
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

/** Çerezi hatırlayan basit istemci (tarayıcı gibi). */
function client(base: string) {
  let cookie = '';
  const request = async (method: string, route: string, body?: unknown, headers: Record<string, string> = {}) => {
    const response = await fetch(base + route, {
      method,
      headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}), ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const setCookie = response.headers.get('set-cookie');
    if (setCookie) cookie = setCookie.split(';')[0]!.endsWith('=') ? '' : setCookie.split(';')[0]!;
    return response;
  };
  return {
    request,
    get: (route: string) => request('GET', route),
    post: (route: string, body: unknown = {}) => request('POST', route, body),
    json: async <T>(response: Response) => (await response.json()) as T,
    get cookie() {
      return cookie;
    },
  };
}

async function register(base: string, email = 'ayse@ornek.com', extra: Record<string, unknown> = {}) {
  const user = client(base);
  const response = await user.post('/auth/register', { email, password: PASSWORD, name: 'Ayşe', country: 'TR', ...extra });
  assert.equal(response.status, 201, await response.clone().text());
  const { recoveryKey } = await user.json<{ recoveryKey: string }>(response);
  return { user, recoveryKey };
}

describe('hesap ve oturum', () => {
  it('kayıt: güvenli çerez, kurtarma anahtarı; oturumsuz analizlere erişilemez', async () => {
    const { base } = await startApp();
    const anonymous = client(base);
    assert.equal((await anonymous.get('/dashboard/summary')).status, 401);
    assert.equal((await anonymous.get('/data/products')).status, 401);

    const user = client(base);
    const response = await user.post('/auth/register', { email: 'Ayse@Ornek.com ', password: PASSWORD, name: 'Ayşe', country: 'TR' });
    assert.equal(response.status, 201);
    const cookie = response.headers.get('set-cookie')!;
    assert.match(cookie, /HttpOnly/);
    assert.match(cookie, /SameSite=Strict/);
    assert.match(cookie, /Path=\/api/);
    const { recoveryKey, email } = await user.json<{ recoveryKey: string; email: string }>(response);
    assert.equal(email, 'ayse@ornek.com');
    assert.match(recoveryKey, /^([A-Z2-9]{4}-){7}[A-Z2-9]{4}$/);

    const me = await user.json<{ email: string; name: string; onboardingCompleted: boolean }>(await user.get('/me'));
    assert.deepEqual([me.email, me.name, me.onboardingCompleted], ['ayse@ornek.com', 'Ayşe', false]);
    assert.equal((await user.request('PATCH', '/me', { onboardingCompleted: true })).status, 204);
    assert.equal((await user.json<{ onboardingCompleted: boolean }>(await user.get('/me'))).onboardingCompleted, true);
  });

  it('zayıf parola, eksik ad/ülke ve aynı e-posta reddedilir', async () => {
    const { base } = await startApp();
    const user = client(base);
    const valid = { email: 'a@b.co', name: 'Ali', country: 'TR', password: PASSWORD };
    for (const password of ['kisa1', 'sadeceharfler', '1234567890', 'aaaaaaaaaaaa']) {
      const response = await user.post('/auth/register', { ...valid, password });
      assert.equal(response.status, 400, password);
      assert.match(((await response.json()) as { error: { message: string } }).error.message, /Parola|parola/);
    }
    assert.equal((await user.post('/auth/register', { ...valid, name: ' ' })).status, 400, 'ad zorunlu');
    assert.equal((await user.post('/auth/register', { ...valid, country: undefined })).status, 400, 'ülke zorunlu');
    assert.equal((await user.post('/auth/register', { ...valid, country: 'XX' })).status, 400, 'geçersiz ülke');
    await register(base, 'a@b.co');
    assert.equal((await client(base).post('/auth/register', { ...valid, email: 'A@B.CO' })).status, 409);
  });

  it('verilerin para birimi ülkeden gelir; yerel para birimi desteklenmiyorsa ABD doları', async () => {
    const { base } = await startApp();
    const status = (await client(base).json<{ countries: { code: string; currency: string; native: string }[] }>(
      await client(base).get('/auth/status'),
    )).countries;
    assert.deepEqual(status.find((c) => c.code === 'SA'), { code: 'SA', currency: 'USD', native: 'SAR' });

    for (const [country, currency] of [['DE', 'EUR'], ['JP', 'JPY'], ['SA', 'USD'], ['TR', 'TRY']] as const) {
      const { user } = await register(base, `${country.toLowerCase()}@ornek.com`, { country });
      const settings = await user.json<{ baseCurrency: string }>(await user.get('/settings'));
      assert.equal(settings.baseCurrency, currency, country);
      assert.equal((await user.json<{ country: string }>(await user.get('/me'))).country, country);
    }
    // Ülke sonradan değişebilir; verilerin para birimi (girilmiş tutarlar) değişmez
    const { user } = await register(base, 'tasinan@ornek.com', { country: 'TR' });
    assert.equal((await user.request('PATCH', '/me', { country: 'XX' })).status, 400);
    assert.equal((await user.request('PATCH', '/me', { country: 'DE' })).status, 204);
    assert.equal((await user.json<{ baseCurrency: string }>(await user.get('/settings'))).baseCurrency, 'TRY');
    assert.equal((await user.request('PATCH', '/me', { name: '' })).status, 400);
  });

  it('kilit varsayılan olarak kapalı: hatalı denemelerden sonra doğru parolayla hemen girilir', async () => {
    const { base } = await startApp();
    await register(base);
    const user = client(base);
    for (let i = 0; i < 7; i++) assert.equal((await user.post('/auth/login', { email: 'ayse@ornek.com', password: 'Yanlis-parola-1' })).status, 401);
    assert.equal((await user.post('/auth/login', { email: 'ayse@ornek.com', password: PASSWORD })).status, 200);
  });

  it('kilit açıksa: hatalı girişte aynı mesaj; 5 hatalı denemede hesap kilitlenir', async () => {
    const { base } = await startApp({ lockoutMinutes: 15 });
    await register(base);
    const attacker = client(base);
    const unknown = await attacker.post('/auth/login', { email: 'yok@ornek.com', password: PASSWORD });
    const wrong = await attacker.post('/auth/login', { email: 'ayse@ornek.com', password: 'Yanlis-parola-1' });
    assert.equal(unknown.status, 401);
    assert.equal(wrong.status, 401);
    assert.deepEqual(await unknown.json(), await wrong.json(), 'e-postanın kayıtlı olup olmadığı anlaşılmaz');

    for (let i = 0; i < 3; i++) await attacker.post('/auth/login', { email: 'ayse@ornek.com', password: 'Yanlis-parola-1' });
    assert.equal((await attacker.post('/auth/login', { email: 'ayse@ornek.com', password: 'Yanlis-parola-1' })).status, 429);
    // Kilitliyken doğru parola da kabul edilmez
    assert.equal((await client(base).post('/auth/login', { email: 'ayse@ornek.com', password: PASSWORD })).status, 429);
  });

  it('çıkış yapınca oturum kapanır; tekrar girişte veriler yerinde', async () => {
    const { base } = await startApp();
    const { user } = await register(base);
    assert.equal((await user.post('/data/regions', { name: 'Bursa' })).status, 201);
    assert.equal((await user.post('/auth/logout')).status, 204);
    assert.equal((await user.get('/data/regions')).status, 401);

    const again = client(base);
    assert.equal((await again.post('/auth/login', { email: 'ayse@ornek.com', password: PASSWORD })).status, 200);
    const { items } = await again.json<{ items: { name: string }[] }>(await again.get('/data/regions'));
    assert.deepEqual(items.map((r) => r.name), ['Bursa']);
  });

  it('her hesap yalnızca kendi verisini görür', async () => {
    const { base } = await startApp();
    const { user: ayse } = await register(base, 'ayse@ornek.com');
    const { user: mehmet } = await register(base, 'mehmet@ornek.com');
    await ayse.post('/data/regions', { name: 'Ayşe Bölgesi' });
    await mehmet.post('/data/regions', { name: 'Mehmet Bölgesi' });
    const names = async (c: ReturnType<typeof client>) =>
      (await c.json<{ items: { name: string }[] }>(await c.get('/data/regions'))).items.map((r) => r.name);
    assert.deepEqual(await names(ayse), ['Ayşe Bölgesi']);
    assert.deepEqual(await names(mehmet), ['Mehmet Bölgesi']);
  });
});

describe('şifreleme', () => {
  it('veriler diskte şifreli; e-posta ve kayıtlar düz metin olarak hiçbir dosyada yok', async () => {
    const { base, dataDir } = await startApp();
    const { user } = await register(base, 'gizli@ornek.com');
    await user.post('/data/regions', { name: 'GizliBolgeXYZ' });
    await user.post('/auth/logout');

    const files = [path.join(dataDir, 'system.db'), ...fs.readdirSync(path.join(dataDir, 'users')).map((f) => path.join(dataDir, 'users', f))];
    for (const file of files) {
      const bytes = fs.readFileSync(file);
      for (const secret of ['GizliBolgeXYZ', 'gizli@ornek.com', PASSWORD]) {
        assert.equal(bytes.includes(Buffer.from(secret)), false, `${path.basename(file)} içinde "${secret}" düz metin`);
      }
    }
    const [workspace] = fs.readdirSync(path.join(dataDir, 'users'));
    assert.equal(fs.readFileSync(path.join(dataDir, 'users', workspace!)).subarray(0, 8).toString(), 'CLARIO01');
  });

  it('şifreli dosyanın bir baytı bile değişirse açılmaz (kurcalama tespiti)', async () => {
    const { base, dataDir } = await startApp();
    const { user } = await register(base);
    await user.post('/auth/logout');
    const [name] = fs.readdirSync(path.join(dataDir, 'users'));
    const file = path.join(dataDir, 'users', name!);
    const bytes = fs.readFileSync(file);
    bytes[bytes.length - 1]! ^= 0xff;
    fs.writeFileSync(file, bytes);
    const originalError = console.error;
    console.error = () => {};
    try {
      const response = await client(base).post('/auth/login', { email: 'ayse@ornek.com', password: PASSWORD });
      assert.equal(response.status, 500);
      assert.match(((await response.json()) as { error: { message: string } }).error.message, /bozulmuş veya değiştirilmiş/);
    } finally {
      console.error = originalError;
    }
  });

  it('kurtarma anahtarıyla yeni parola belirlenir; eski parola geçmez, veri korunur', async () => {
    const { base } = await startApp();
    const { user, recoveryKey } = await register(base);
    await user.post('/data/regions', { name: 'Ankara' });
    await user.post('/auth/logout');

    const other = client(base);
    assert.equal((await other.post('/auth/recover', { email: 'ayse@ornek.com', recoveryKey: 'AAAA-BBBB', newPassword: 'Yeni-parola-99' })).status, 401);
    // Küçük harf ve boşluklarla yazılsa da kabul edilir
    const recovered = await other.post('/auth/recover', { email: 'ayse@ornek.com', recoveryKey: ` ${recoveryKey.toLowerCase()} `, newPassword: 'Yeni-parola-99' });
    assert.equal(recovered.status, 200);
    assert.deepEqual((await other.json<{ items: { name: string }[] }>(await other.get('/data/regions'))).items.map((r) => r.name), ['Ankara']);
    assert.equal((await client(base).post('/auth/login', { email: 'ayse@ornek.com', password: PASSWORD })).status, 401);
    assert.equal((await client(base).post('/auth/login', { email: 'ayse@ornek.com', password: 'Yeni-parola-99' })).status, 200);
  });

  it('parola değişince diğer cihazlardaki oturumlar kapanır', async () => {
    const { base } = await startApp();
    const { user: laptop } = await register(base);
    const phone = client(base);
    await phone.post('/auth/login', { email: 'ayse@ornek.com', password: PASSWORD });
    assert.equal((await laptop.post('/auth/password', { currentPassword: 'yanlis', newPassword: 'Yeni-parola-99' })).status, 401);
    assert.equal((await laptop.post('/auth/password', { currentPassword: PASSWORD, newPassword: 'Yeni-parola-99' })).status, 204);
    assert.equal((await laptop.get('/me')).status, 200);
    assert.equal((await phone.get('/me')).status, 401);
  });

  it('verileri sıfırla: işletme verisi silinir; hesap, profil ve para birimi kalır', async () => {
    const { base } = await startApp();
    const { user } = await register(base, 'sifirla@ornek.com', { country: 'DE' });
    await user.post('/data/regions', { name: 'Demo Bölge' });
    assert.equal((await user.post('/auth/reset-data', { password: 'yanlis-parola-1' })).status, 401);
    assert.equal((await user.post('/auth/reset-data', { password: PASSWORD })).status, 204);
    assert.deepEqual((await user.json<{ items: unknown[] }>(await user.get('/data/regions'))).items, []);
    assert.equal((await user.json<{ baseCurrency: string }>(await user.get('/settings'))).baseCurrency, 'EUR');
    // Çıkış yapıp tekrar girince de boş (değişiklik şifreli dosyaya yazıldı)
    await user.post('/auth/logout');
    const again = client(base);
    await again.post('/auth/login', { email: 'sifirla@ornek.com', password: PASSWORD });
    assert.deepEqual((await again.json<{ items: unknown[] }>(await again.get('/data/regions'))).items, []);
  });

  it('hesap silinince şifreli dosya da silinir', async () => {
    const { base, dataDir } = await startApp();
    const { user } = await register(base);
    assert.equal((await user.request('DELETE', '/auth/account', { password: 'yanlis-parola-1' })).status, 401);
    assert.equal((await user.request('DELETE', '/auth/account', { password: PASSWORD })).status, 204);
    assert.deepEqual(fs.readdirSync(path.join(dataDir, 'users')), []);
    assert.equal((await client(base).post('/auth/login', { email: 'ayse@ornek.com', password: PASSWORD })).status, 401);
  });
});

describe('web güvenliği', () => {
  it('CSRF: istemci başlığı olmayan veri değiştiren istek reddedilir; güvenlik başlıkları var', async () => {
    const { base } = await startApp();
    const { user } = await register(base);
    const forged = await user.request('POST', '/data/regions', { name: 'Sahte' }, { 'X-Clario-Client': '' });
    assert.equal(forged.status, 403);
    const response = await user.get('/me');
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(response.headers.get('x-frame-options'), 'DENY');
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal(response.headers.get('x-powered-by'), null);
  });

  it('başka bir siteden (izin verilmeyen origin) çerezli istek için CORS izni verilmez', async () => {
    const { base } = await startApp();
    const preflight = await fetch(`${base}/data/regions`, {
      method: 'OPTIONS',
      headers: { Origin: 'https://kotu-site.example', 'Access-Control-Request-Method': 'POST' },
    });
    assert.equal(preflight.headers.get('access-control-allow-origin'), null);
    assert.equal(preflight.headers.get('access-control-allow-credentials'), null);
  });
});

describe('yeni hesap', () => {
  it('boş başlar: bu bilgisayarda başka veri olsa bile hiçbir kayıt görmez', async () => {
    const { base } = await startApp();
    const { user: first } = await register(base, 'ilk@ornek.com');
    await first.post('/data/regions', { name: 'İlk hesabın bölgesi' });
    const { user } = await register(base, 'yeni@ornek.com');
    for (const resource of ['regions', 'products', 'customers', 'expenses']) {
      const { items } = await user.json<{ items: unknown[] }>(await user.get(`/data/${resource}`));
      assert.deepEqual(items, [], resource);
    }
    assert.equal((await user.get('/dashboard/summary')).status, 503, 'veri yok');
  });
});
