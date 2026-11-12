import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { after, before, describe, it } from 'node:test';
import { createTestApp } from './helpers.js';
import { openDatabase, type DbClient } from '../src/db/index.js';
import { createSeededDb, TEST_AS_OF } from './helpers.js';

async function startServer(db: DbClient): Promise<{ server: Server; baseUrl: string }> {
  const server = createTestApp(db, { corsOrigins: 'localhost' }).listen(0);
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const { port } = server.address() as AddressInfo;
  return { server, baseUrl: `http://127.0.0.1:${port}/api` };
}

describe('HTTP API', () => {
  let db: DbClient;
  let server: Server;
  let baseUrl: string;

  before(async () => {
    ({ db } = await createSeededDb());
    ({ server, baseUrl } = await startServer(db));
  });
  after(async () => {
    server.close();
    await db.close();
  });

  const endpoints = [
    '',
    '/health',
    '/dashboard/summary',
    '/sales/analytics',
    '/inventory/intelligence',
    '/customers/analysis',
    '/risks',
    '/opportunities',
    '/margins',
    '/customers/churn',
    '/recommendations',
  ];

  for (const path of endpoints) {
    it(`GET ${path} → 200`, async () => {
      const response = await fetch(baseUrl + path);
      assert.equal(response.status, 200);
      const body = (await response.json()) as Record<string, unknown>;
      if (path !== '' && path !== '/health') assert.equal(body.asOf, TEST_AS_OF);
    });
  }

  it('dashboard KPI\'ları risk/fırsat/kayıp sayılarını içerir', async () => {
    const body = (await (await fetch(`${baseUrl}/dashboard/summary`)).json()) as {
      kpis: { openRisks: number; opportunities: number; churnRisks: number; revenue: { current: number } };
    };
    assert.ok(body.kpis.revenue.current > 0);
    assert.ok(body.kpis.openRisks > 0);
    assert.ok(body.kpis.opportunities > 0);
    assert.ok(body.kpis.churnRisks >= 3);
  });

  it('POST /assistant/ask soruyu analize yönlendirir', async () => {
    const response = await fetch(`${baseUrl}/assistant/ask`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ question: 'Bu ay neden satışlar düştü?' }),
    });
    assert.equal(response.status, 200);
    const body = (await response.json()) as { intent: string; answer: string };
    assert.equal(body.intent, 'sales_change');
    assert.match(body.answer, /Ciro son 30 günde/);
  });

  it('POST /assistant/ask boş soruyu 400 ile reddeder', async () => {
    const response = await fetch(`${baseUrl}/assistant/ask`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ question: '   ' }),
    });
    assert.equal(response.status, 400);
  });

  it('geçersiz JSON 400 döner', async () => {
    const response = await fetch(`${baseUrl}/assistant/ask`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{bozuk',
    });
    assert.equal(response.status, 400);
  });

  it('CORS: localhost portlarına başlık ekler, dış adreslere eklemez', async () => {
    for (const origin of ['http://localhost:5173', 'http://localhost:5174', 'http://127.0.0.1:5180']) {
      const allowed = await fetch(`${baseUrl}/health`, { headers: { origin } });
      assert.equal(allowed.headers.get('access-control-allow-origin'), origin);
    }
    const other = await fetch(`${baseUrl}/health`, { headers: { origin: 'http://localhost.evil.example' } });
    assert.equal(other.headers.get('access-control-allow-origin'), null);
    const preflight = await fetch(`${baseUrl}/assistant/ask`, {
      method: 'OPTIONS',
      headers: { origin: 'http://localhost:5173', 'access-control-request-method': 'POST' },
    });
    assert.equal(preflight.status, 204);
  });

  it('bilinmeyen endpoint 404 döner', async () => {
    const response = await fetch(`${baseUrl}/yok`);
    assert.equal(response.status, 404);
  });
});

describe('beklenmeyen hatalar', () => {
  it('veritabanı hatası 500 ve anlamlı JSON mesajı döner, sunucu çökmez', async () => {
    const db = await openDatabase(':memory:');
    const { server, baseUrl } = await startServer(db);
    const originalError = console.error;
    console.error = () => {}; // beklenen hata logunu test çıktısından gizle
    try {
      await db.close(); // bağlantı koptu: her sorgu hata fırlatır
      for (const path of ['/risks', '/dashboard/summary', '/customers/analysis']) {
        const response = await fetch(baseUrl + path);
        assert.equal(response.status, 500);
        const body = (await response.json()) as { error: { message: string } };
        assert.match(body.error.message, new RegExp(`GET /api${path}`));
      }
      assert.equal((await fetch(`${baseUrl}/yok`)).status, 404); // sunucu hâlâ yanıt veriyor
    } finally {
      console.error = originalError;
      server.close();
    }
  });
});

describe('boş veritabanı', () => {
  it('analiz endpoint\'leri 503 ve veri girişi yönlendirmesi döner, health çalışır', async () => {
    const db = await openDatabase(':memory:');
    const { server, baseUrl } = await startServer(db);
    try {
      assert.equal((await fetch(`${baseUrl}/health`)).status, 200);
      const response = await fetch(`${baseUrl}/risks`);
      assert.equal(response.status, 503);
      const body = (await response.json()) as { error: { message: string } };
      assert.match(body.error.message, /Veri Yönetimi/);
    } finally {
      server.close();
      await db.close();
    }
  });
});
