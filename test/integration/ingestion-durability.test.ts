import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { IngestInboundMessage } from '../../src/application/ingest-inbound-message.js';
import { GetConversationDetail } from '../../src/application/use-cases/get-conversation-detail.js';
import { ListConversations } from '../../src/application/use-cases/list-conversations.js';
import { type DbClient, createDbClient } from '../../src/infrastructure/db/client.js';
import { DrizzleUnitOfWork } from '../../src/infrastructure/db/unit-of-work.js';
import { runMigrations } from '../../src/infrastructure/db/migrator.js';
import { PgWorkerQueue } from '../../src/infrastructure/job-queue/pg-worker-queue.js';
import { DrizzleConversationRepository } from '../../src/infrastructure/repositories/conversation-repository.js';
import { DrizzleJobEnqueuer } from '../../src/infrastructure/repositories/job-enqueuer.js';
import { DrizzleMessageRepository } from '../../src/infrastructure/repositories/message-repository.js';
import { PgNotifier } from '../../src/infrastructure/repositories/notifier.js';
import { DrizzleWebhookEventRepository } from '../../src/infrastructure/repositories/webhook-event-repository.js';
import { buildServer } from '../../src/http/server.js';
import { silentLogger } from '../helpers/silent-logger.js';

const FORM_HEADERS = { 'content-type': 'application/x-www-form-urlencoded' };
const LEASE_MS = 60_000;

let container: StartedPostgreSqlContainer;
let client: DbClient;
let sql: DbClient['sql'];
let app: FastifyInstance;
let queue: PgWorkerQueue;

const webhookForm = (): string =>
  new URLSearchParams({
    From: '+15550001234',
    To: '+15559876543',
    Body: 'hello there',
    MessageSid: 'SMdurability00000000000000000000001',
  }).toString();

beforeAll(async () => {
  container = await new PostgreSqlContainer('postgres:16').start();
  const url = container.getConnectionUri();
  await runMigrations(url);
  client = createDbClient(url, { max: 6 });
  sql = client.sql;
  const conversations = new DrizzleConversationRepository(client.db);
  const messages = new DrizzleMessageRepository(client.db);
  queue = new PgWorkerQueue(sql, { leaseDurationMs: LEASE_MS });
  app = buildServer({
    listConversations: new ListConversations(conversations),
    getConversationDetail: new GetConversationDetail(conversations, messages),
    ingestInboundMessage: new IngestInboundMessage(
      new DrizzleUnitOfWork(client.db),
      new DrizzleWebhookEventRepository(),
      conversations,
      messages,
      new DrizzleJobEnqueuer(),
      new PgNotifier(),
      silentLogger,
    ),
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

describe('ingestion durability (accepted webhook → claimable job)', () => {
  it('should yield a job the real queue can claim for the accepted message', async () => {
    const ack = await app.inject({
      method: 'POST',
      url: '/webhooks/twilio/sms',
      headers: FORM_HEADERS,
      payload: webhookForm(),
    });
    expect(ack.statusCode).toBe(200);

    const [inbound] = await sql<{ id: string; conversation_id: string }[]>`
      select id, conversation_id from messages where direction = 'inbound'`;
    expect(inbound).toBeDefined();

    const claimed = await queue.claim('worker-durability');

    expect(claimed).not.toBeNull();
    expect(claimed?.inboundMessageId).toBe(inbound!.id);
    expect(claimed?.conversationId).toBe(inbound!.conversation_id);
    expect(claimed?.status).toBe('running');
  });
});
