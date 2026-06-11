import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { type DbClient, createDbClient } from '../../src/infrastructure/db/client.js';
import { runMigrations } from '../../src/infrastructure/db/migrator.js';
import { buildTestApp } from './helpers/build-app.js';

let container: StartedPostgreSqlContainer;
let client: DbClient;
let sql: DbClient['sql'];
let mockApp: FastifyInstance;
let twilioApp: FastifyInstance;

const FORM_HEADERS = { 'content-type': 'application/json' };

beforeAll(async () => {
  container = await new PostgreSqlContainer('postgres:16').start();
  const url = container.getConnectionUri();
  await runMigrations(url);
  client = createDbClient(url, { max: 6 });
  sql = client.sql;
  mockApp = buildTestApp(client, { simulate: true }).app;
  twilioApp = buildTestApp(client, { simulate: false }).app;
  await mockApp.ready();
  await twilioApp.ready();
});

afterAll(async () => {
  try {
    await mockApp?.close();
    await twilioApp?.close();
    await sql?.end();
  } finally {
    await container?.stop();
  }
});

beforeEach(async () => {
  await sql`truncate conversations, messages, jobs, webhook_events restart identity cascade`;
});

async function messageCount(): Promise<number> {
  const [row] = await sql<{ count: number }[]>`select count(*)::int as count from messages`;
  return row?.count ?? 0;
}

describe('POST /dev/simulate-inbound', () => {
  it('should drive the real ingest path in mock mode, creating an inbound message and a job', async () => {
    const res = await mockApp.inject({
      method: 'POST',
      url: '/dev/simulate-inbound',
      headers: FORM_HEADERS,
      payload: { from: '+15550001234', body: 'hello from the browser' },
    });

    expect(res.statusCode).toBe(200);
    expect(await messageCount()).toBe(1);
    const [job] = await sql<{ count: number }[]>`select count(*)::int as count from jobs`;
    expect(job?.count).toBe(1);
  });

  it('should reject a malformed payload with 400', async () => {
    const res = await mockApp.inject({
      method: 'POST',
      url: '/dev/simulate-inbound',
      headers: FORM_HEADERS,
      payload: { body: 'no from' },
    });
    expect(res.statusCode).toBe(400);
    expect(await messageCount()).toBe(0);
  });

  it('should reject a non-E.164 from with 400 and persist nothing', async () => {
    const res = await mockApp.inject({
      method: 'POST',
      url: '/dev/simulate-inbound',
      headers: FORM_HEADERS,
      payload: { from: 'not-a-phone', body: 'hi' },
    });
    expect(res.statusCode).toBe(400);
    expect(await messageCount()).toBe(0);
  });

  it('should not exist in twilio mode (route is absent, 404)', async () => {
    const res = await twilioApp.inject({
      method: 'POST',
      url: '/dev/simulate-inbound',
      headers: FORM_HEADERS,
      payload: { from: '+15550001234', body: 'hi' },
    });
    expect(res.statusCode).toBe(404);
  });
});
