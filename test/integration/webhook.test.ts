import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { IngestInboundMessage } from '../../src/application/ingest-inbound-message.js';
import { GetConversationDetail } from '../../src/application/use-cases/get-conversation-detail.js';
import { ListConversations } from '../../src/application/use-cases/list-conversations.js';
import { type DbClient, createDbClient } from '../../src/infrastructure/db/client.js';
import { DrizzleUnitOfWork } from '../../src/infrastructure/db/unit-of-work.js';
import { runMigrations } from '../../src/infrastructure/db/migrator.js';
import { DrizzleConversationRepository } from '../../src/infrastructure/repositories/conversation-repository.js';
import { DrizzleJobEnqueuer } from '../../src/infrastructure/repositories/job-enqueuer.js';
import { DrizzleMessageRepository } from '../../src/infrastructure/repositories/message-repository.js';
import { PgNotifier } from '../../src/infrastructure/repositories/notifier.js';
import { DrizzleWebhookEventRepository } from '../../src/infrastructure/repositories/webhook-event-repository.js';
import { buildServer } from '../../src/http/server.js';

let container: StartedPostgreSqlContainer;
let client: DbClient;
let sql: DbClient['sql'];
let app: FastifyInstance;

const FORM_HEADERS = { 'content-type': 'application/x-www-form-urlencoded' };

beforeAll(async () => {
  container = await new PostgreSqlContainer('postgres:16').start();
  const url = container.getConnectionUri();
  await runMigrations(url);
  client = createDbClient(url, { max: 6 });
  sql = client.sql;
  const conversations = new DrizzleConversationRepository(client.db);
  const messages = new DrizzleMessageRepository(client.db);
  const ingestInboundMessage = new IngestInboundMessage(
    new DrizzleUnitOfWork(client.db),
    new DrizzleWebhookEventRepository(),
    conversations,
    messages,
    new DrizzleJobEnqueuer(),
    new PgNotifier(),
  );
  app = buildServer({
    listConversations: new ListConversations(conversations),
    getConversationDetail: new GetConversationDetail(conversations, messages),
    ingestInboundMessage,
    eventBus: { subscribe: () => () => {} },
    heartbeatMs: 15_000,
  });
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
  await sql`truncate jobs, messages, conversations, webhook_events restart identity cascade`;
});

let seq = 0;
const form = (overrides: Record<string, string> = {}): string => {
  const sid = `SM${String(++seq).padStart(32, '0')}`;
  const fields = {
    From: '+15550001234',
    To: '+15559876543',
    Body: 'hello there',
    MessageSid: sid,
    ...overrides,
  };
  return new URLSearchParams(fields).toString();
};

async function messageCount(): Promise<number> {
  const [row] = await sql<{ count: string }[]>`select count(*)::int as count from messages`;
  return Number(row!.count);
}

describe('POST /webhooks/twilio/sms', () => {
  it('should ack with 200 text/xml <Response/> and persist one message and job', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/webhooks/twilio/sms',
      headers: FORM_HEADERS,
      payload: form(),
    });

    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/xml');
    expect(res.body).toBe('<Response/>');

    expect(await messageCount()).toBe(1);
    const [job] = await sql<{ count: string }[]>`select count(*)::int as count from jobs`;
    expect(Number(job!.count)).toBe(1);
  });

  it('should treat a redelivered MessageSid as a duplicate: identical ack, no new rows', async () => {
    const payload = form({ MessageSid: 'SMduplicate0000000000000000000001' });

    const first = await app.inject({ method: 'POST', url: '/webhooks/twilio/sms', headers: FORM_HEADERS, payload });
    const second = await app.inject({ method: 'POST', url: '/webhooks/twilio/sms', headers: FORM_HEADERS, payload });

    expect(first.body).toBe('<Response/>');
    expect(second.statusCode).toBe(200);
    expect(second.body).toBe('<Response/>');
    expect(await messageCount()).toBe(1);
  });

  it('should reject a malformed payload with 400 and persist nothing', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/webhooks/twilio/sms',
      headers: FORM_HEADERS,
      payload: form({ From: '' }),
    });

    expect(res.statusCode).toBe(400);
    expect(res.json<{ error: string }>().error).toBeTruthy();
    expect(await messageCount()).toBe(0);
  });

  it('should reject a non-empty but malformed phone number with 400 and persist nothing', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/webhooks/twilio/sms',
      headers: FORM_HEADERS,
      payload: form({ From: 'not-a-phone' }),
    });

    expect(res.statusCode).toBe(400);
    expect(res.json<{ error: string }>().error).toBeTruthy();
    expect(await messageCount()).toBe(0);
  });
});
