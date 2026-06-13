import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { type DbClient, createDbClient } from '../../src/infrastructure/db/client.js';
import { runMigrations } from '../../src/infrastructure/db/migrator.js';
import { MockSmsProvider } from '../../src/infrastructure/sms/mock-sms-provider.js';

import { buildTestApp } from './helpers/build-app.js';

let container: StartedPostgreSqlContainer;
let client: DbClient;
let sql: DbClient['sql'];
let app: FastifyInstance;
let provider: MockSmsProvider;

const JSON_HEADERS = { 'content-type': 'application/json' };

beforeAll(async () => {
  container = await new PostgreSqlContainer('postgres:16').start();
  const url = container.getConnectionUri();
  await runMigrations(url);
  client = createDbClient(url, { max: 6 });
  sql = client.sql;
  provider = new MockSmsProvider({ recordSends: true });
  app = buildTestApp(client, { smsProvider: provider }).app;
  await app.ready();
});

afterAll(async () => {
  try {
    await app?.close();
    await sql?.end();
  } finally {
    await container?.stop();
  }
});

beforeEach(async () => {
  await sql`truncate conversations, messages, jobs, webhook_events restart identity cascade`;
  provider.reset();
});

interface OutboundRow {
  status: string;
  body: string;
  error_detail: string | null;
}

async function outboundRows(): Promise<OutboundRow[]> {
  return sql<OutboundRow[]>`
    select status, body, error_detail from messages where direction = 'outbound' order by created_at`;
}

async function conversationCount(): Promise<number> {
  const [row] = await sql<{ count: number }[]>`select count(*)::int as count from conversations`;
  return row?.count ?? 0;
}

function send(payload: Record<string, unknown>) {
  return app.inject({ method: 'POST', url: '/api/messages/send', headers: JSON_HEADERS, payload });
}

describe('POST /api/messages/send', () => {
  it('should send an outbound message and persist it as sent', async () => {
    const res = await send({ to: '+15551230001', body: 'hello there' });

    expect(res.statusCode).toBe(202);
    expect(typeof res.json().idempotencyKey).toBe('string');
    expect(provider.sentMessages).toHaveLength(1);
    expect(provider.sentMessages[0]?.to).toBe('+15551230001');

    const rows = await outboundRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.status).toBe('sent');
    expect(rows[0]?.body).toBe('hello there');
  });

  it('should mark the message failed and return 502 when the provider rejects the send', async () => {
    provider.failAlways();

    const res = await send({ to: '+15551230001', body: 'will fail' });

    expect(res.statusCode).toBe(502);
    const rows = await outboundRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.status).toBe('failed');
    expect(rows[0]?.error_detail).toBeTruthy();
  });

  it('should not send twice for a repeated idempotency key', async () => {
    const first = await send({ to: '+15551230001', body: 'once', idempotencyKey: 'dup-key-1' });
    const second = await send({ to: '+15551230001', body: 'once', idempotencyKey: 'dup-key-1' });

    expect(first.statusCode).toBe(202);
    expect(first.json().idempotencyKey).toBe('dup-key-1');
    expect(second.statusCode).toBe(200);
    expect(second.json()).toEqual({ duplicate: true });
    expect(provider.sentMessages).toHaveLength(1);
    expect(await outboundRows()).toHaveLength(1);
  });

  it('should reuse an existing conversation for the same recipient', async () => {
    await send({ to: '+15551230001', body: 'first' });
    await send({ to: '+15551230001', body: 'second' });

    expect(await conversationCount()).toBe(1);
    expect(await outboundRows()).toHaveLength(2);
  });

  it('should reject a non-E.164 recipient with 400 and persist nothing', async () => {
    const res = await send({ to: 'not-a-phone', body: 'hi' });

    expect(res.statusCode).toBe(400);
    expect(provider.sentMessages).toHaveLength(0);
    expect(await outboundRows()).toHaveLength(0);
  });

  it('should reject an invalid payload with 400', async () => {
    const res = await send({ body: 'no recipient' });

    expect(res.statusCode).toBe(400);
    expect(await outboundRows()).toHaveLength(0);
  });
});
