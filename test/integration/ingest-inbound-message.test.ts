import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { IngestInboundMessage } from '../../src/application/ingest-inbound-message.js';
import type { Notifier } from '../../src/application/ports/notifier.js';
import { type DbClient, createDbClient } from '../../src/infrastructure/db/client.js';
import { runMigrations } from '../../src/infrastructure/db/migrator.js';
import { DrizzleUnitOfWork } from '../../src/infrastructure/db/unit-of-work.js';
import { DrizzleConversationRepository } from '../../src/infrastructure/repositories/conversation-repository.js';
import { DrizzleJobEnqueuer } from '../../src/infrastructure/repositories/job-enqueuer.js';
import { DrizzleMessageRepository } from '../../src/infrastructure/repositories/message-repository.js';
import { PgNotifier } from '../../src/infrastructure/repositories/notifier.js';
import { DrizzleWebhookEventRepository } from '../../src/infrastructure/repositories/webhook-event-repository.js';

let container: StartedPostgreSqlContainer;
let client: DbClient;
let uow: DrizzleUnitOfWork;
let ingest: IngestInboundMessage;

const command = { from: '+15550001234', to: '+15559876543', body: 'hi', providerSid: 'SM-001' };
const rawPayload = { MessageSid: 'SM-001', From: command.from, To: command.to, Body: command.body };

function makeIngest(notifier: Notifier): IngestInboundMessage {
  return new IngestInboundMessage(
    uow,
    new DrizzleWebhookEventRepository(),
    new DrizzleConversationRepository(client.db),
    new DrizzleMessageRepository(client.db),
    new DrizzleJobEnqueuer(),
    notifier,
  );
}

async function countRows(table: 'conversations' | 'messages' | 'jobs' | 'webhook_events'): Promise<number> {
  const rows = await client.sql<{ count: number }[]>`select count(*)::int as count from ${client.sql(table)}`;
  return rows[0]?.count ?? 0;
}

beforeAll(async () => {
  container = await new PostgreSqlContainer('postgres:16').start();
  const url = container.getConnectionUri();
  await runMigrations(url);
  client = createDbClient(url, { max: 5 });
  uow = new DrizzleUnitOfWork(client.db);
  ingest = makeIngest(new PgNotifier());
});

afterAll(async () => {
  try {
    await client?.sql?.end();
  } finally {
    await container?.stop();
  }
});

beforeEach(async () => {
  await client.sql`truncate conversations, messages, jobs, webhook_events restart identity cascade`;
});

describe('IngestInboundMessage', () => {
  it('should accept a new inbound message as one conversation, message and job', async () => {
    const result = await ingest.execute(command, rawPayload);
    expect(result).toEqual({
      duplicate: false,
      conversationId: expect.any(String),
      messageId: expect.any(String),
    });
    expect(await countRows('conversations')).toBe(1);
    expect(await countRows('messages')).toBe(1);
    expect(await countRows('jobs')).toBe(1);
    const status = await client.sql<{ status: string }[]>`select status from messages limit 1`;
    expect(status[0]?.status).toBe('received');
  });

  it('should short-circuit a duplicate providerSid with no new writes', async () => {
    await ingest.execute(command, rawPayload);
    const result = await ingest.execute(command, rawPayload);
    expect(result).toEqual({ duplicate: true });
    expect(await countRows('conversations')).toBe(1);
    expect(await countRows('messages')).toBe(1);
    expect(await countRows('jobs')).toBe(1);
  });

  it('should roll back the whole transaction (including the ledger) when a step fails', async () => {
    const throwingNotifier: Notifier = {
      jobCreated: () => Promise.reject(new Error('notify boom')),
      conversationChanged: () => Promise.resolve(),
    };
    await expect(makeIngest(throwingNotifier).execute(command, rawPayload)).rejects.toThrow(
      'notify boom',
    );
    expect(await countRows('webhook_events')).toBe(0);
    expect(await countRows('conversations')).toBe(0);
    expect(await countRows('messages')).toBe(0);
    expect(await countRows('jobs')).toBe(0);
  });

  it('should deliver job_created after the transaction commits', async () => {
    let onNotify: (payload: string) => void = () => {};
    const arrived = new Promise<string>((resolve) => {
      onNotify = resolve;
    });
    const listener = await client.sql.listen('job_created', (payload) => onNotify(payload));
    await ingest.execute(command, rawPayload);
    const timeout = setTimeout(() => onNotify('__timeout__'), 2000);
    const payload = await arrived;
    clearTimeout(timeout);
    await listener.unlisten();
    expect(payload).toBe('');
  });

  it('should not deliver job_created when the transaction rolls back', async () => {
    const received: string[] = [];
    const listener = await client.sql.listen('job_created', (payload) => {
      received.push(payload);
    });
    const notifier = new PgNotifier();
    await expect(
      uow.run(async (tx) => {
        await notifier.jobCreated(tx);
        throw new Error('rollback');
      }),
    ).rejects.toThrow('rollback');
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(received).toHaveLength(0);
    await listener.unlisten();
  });
});
