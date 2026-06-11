import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { type DbClient, createDbClient } from '../../src/infrastructure/db/client.js';

import { buildTestApp } from './helpers/build-app.js';

const INDEX_HTML = '<!doctype html><html><body><div id="root"></div>cadence-admin</body></html>';

let client: DbClient;
let app: FastifyInstance;
let adminDir: string;

beforeAll(async () => {
  // No queries are issued on the static/SPA/config/404 paths, so a lazy (never-connected)
  // postgres.js client is enough — no container needed for this server-behaviour test.
  client = createDbClient('postgresql://cadence:cadence@127.0.0.1:1/none');
  adminDir = mkdtempSync(join(tmpdir(), 'cadence-admin-'));
  writeFileSync(join(adminDir, 'index.html'), INDEX_HTML);
  writeFileSync(join(adminDir, 'favicon.svg'), '<svg/>');
  app = buildTestApp(client, { simulate: true, adminDir }).app;
  await app.ready();
});

afterAll(async () => {
  await app?.close();
  await client?.sql?.end();
  rmSync(adminDir, { recursive: true, force: true });
});

describe('serving the admin SPA', () => {
  it('should serve index.html at the root', async () => {
    const res = await app.inject({ url: '/' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/html');
    expect(res.body).toContain('cadence-admin');
  });

  it('should serve a real static asset that exists', async () => {
    const res = await app.inject({ url: '/favicon.svg' });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('<svg/>');
  });

  it('should fall back to index.html for a client-side route (deep link)', async () => {
    const res = await app.inject({ url: '/c/2b1ed55c-9276-4182-a049-67f0e0190a74' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/html');
    expect(res.body).toContain('cadence-admin');
  });

  it('should let the real API routes win over the SPA fallback', async () => {
    const res = await app.inject({ url: '/api/config' });
    expect(res.statusCode).toBe(200);
    expect(res.json<{ smsProvider: string }>()).toEqual({ smsProvider: 'mock' });
  });

  it('should return a JSON 404 (not the SPA) for an unknown API path', async () => {
    const res = await app.inject({ url: '/api/does-not-exist' });
    expect(res.statusCode).toBe(404);
    expect(res.headers['content-type']).toContain('application/json');
    expect(res.body).not.toContain('cadence-admin');
  });
});
