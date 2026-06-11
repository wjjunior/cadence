import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Tx } from '../../src/application/ports/tx.js';
import { encodeConversationCursor } from '../../src/application/pagination/conversation-cursor.js';
import { conversationKey } from '../../src/domain/conversation.js';
import { inboundStatus } from '../../src/domain/status.js';
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
let conversations: DrizzleConversationRepository;
let messages: DrizzleMessageRepository;
let webhookEvents: DrizzleWebhookEventRepository;
let jobs: DrizzleJobEnqueuer;
let notifier: PgNotifier;
let phoneSeq = 0;

beforeAll(async () => {
  container = await new PostgreSqlContainer('postgres:16').start();
  const url = container.getConnectionUri();
  await runMigrations(url);
  client = createDbClient(url, { max: 5 });
  uow = new DrizzleUnitOfWork(client.db);
  conversations = new DrizzleConversationRepository(client.db);
  messages = new DrizzleMessageRepository(client.db);
  webhookEvents = new DrizzleWebhookEventRepository();
  jobs = new DrizzleJobEnqueuer();
  notifier = new PgNotifier();
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

function nextKey() {
  const n = ++phoneSeq;
  return conversationKey(`+1555${String(n).padStart(7, '0')}`, `+1999${String(n).padStart(7, '0')}`);
}

async function seedInbound(): Promise<{ conversationId: string; messageId: string }> {
  return uow.run(async (tx: Tx) => {
    const conversation = await conversations.upsert(tx, nextKey());
    const message = await messages.insertInbound(tx, {
      conversationId: conversation.id,
      body: 'hi',
      providerMessageSid: `SM-${phoneSeq}-${Date.now()}`,
    });
    return { conversationId: conversation.id, messageId: message.id };
  });
}

describe('DrizzleConversationRepository', () => {
  it('should upsert idempotently on the (user_phone, system_phone) pair', async () => {
    const key = nextKey();
    const first = await uow.run((tx) => conversations.upsert(tx, key));
    const second = await uow.run((tx) => conversations.upsert(tx, key));
    expect(second.id).toBe(first.id);
  });

  it('should set last_message_at on the first insert so a single-message conversation tops the list', async () => {
    const created = await uow.run((tx) => conversations.upsert(tx, nextKey()));
    expect(created.lastMessageAt).not.toBeNull();
    const page = await conversations.list({ cursor: null, limit: 10 });
    expect(page[0]?.id).toBe(created.id);
  });

  it('should bump last_message_at on touch', async () => {
    const created = await uow.run((tx) => conversations.upsert(tx, nextKey()));
    await new Promise((r) => setTimeout(r, 5));
    await uow.run((tx) => conversations.touch(tx, created.id));
    const after = await conversations.getById(created.id);
    expect(after?.lastMessageAt.getTime()).toBeGreaterThan(created.lastMessageAt.getTime());
  });

  it('should paginate by keyset without skipping or duplicating rows at the boundary', async () => {
    for (let i = 0; i < 5; i++) {
      const c = await uow.run((tx) => conversations.upsert(tx, nextKey()));
      // identical last_message_at across all rows exercises the id tiebreak
      await client.sql`update conversations set last_message_at = '2026-06-11T00:00:00Z' where id = ${c.id}`;
    }
    const full = await conversations.list({ cursor: null, limit: 10 });
    const pageOne = await conversations.list({ cursor: null, limit: 2 });
    const last = pageOne[1]!;
    const cursor = encodeConversationCursor({
      lastMessageAt: last.lastMessageAt.toISOString(),
      id: last.id,
    });
    const pageTwo = await conversations.list({ cursor, limit: 2 });
    expect([...pageOne, ...pageTwo].map((c) => c.id)).toEqual(full.slice(0, 4).map((c) => c.id));
  });
});

describe('DrizzleWebhookEventRepository', () => {
  it('should report inserted true then false for a repeated provider_sid', async () => {
    const first = await uow.run((tx) =>
      webhookEvents.insertIgnoringDuplicate(tx, 'SM-dup', { raw: 1 }),
    );
    const second = await uow.run((tx) =>
      webhookEvents.insertIgnoringDuplicate(tx, 'SM-dup', { raw: 1 }),
    );
    expect(first.inserted).toBe(true);
    expect(second.inserted).toBe(false);
  });
});

describe('DrizzleMessageRepository', () => {
  it('should return the same outbound row on a repeated idempotency key', async () => {
    const { conversationId, messageId } = await seedInbound();
    const insert = (): Promise<{ id: string }> =>
      uow.run((tx) =>
        messages.insertOutbound(tx, {
          conversationId,
          body: 'reply',
          idempotencyKey: `reply:${messageId}`,
          inReplyTo: messageId,
          providerMessageSid: null,
        }),
      );
    const first = await insert();
    const second = await insert();
    expect(second.id).toBe(first.id);
  });

  it('should update status with markStatus', async () => {
    const { conversationId, messageId } = await seedInbound();
    await uow.run((tx) => messages.markStatus(tx, messageId, inboundStatus.processing));
    const list = await messages.listByConversation(conversationId);
    expect(list[0]?.status).toBe(inboundStatus.processing);
  });

  it('should preserve error_detail on a status change that omits it', async () => {
    const { conversationId, messageId } = await seedInbound();
    await uow.run((tx) => messages.markStatus(tx, messageId, inboundStatus.processing, 'boom'));
    await uow.run((tx) => messages.markStatus(tx, messageId, inboundStatus.processed));
    const list = await messages.listByConversation(conversationId);
    expect(list[0]?.errorDetail).toBe('boom');
    expect(list[0]?.status).toBe(inboundStatus.processed);
  });

  it('should list messages by conversation in created_at order', async () => {
    const { conversationId } = await seedInbound();
    await uow.run((tx) =>
      messages.insertInbound(tx, {
        conversationId,
        body: 'second',
        providerMessageSid: `SM-second-${Date.now()}`,
      }),
    );
    const list = await messages.listByConversation(conversationId);
    expect(list).toHaveLength(2);
    expect(list[0]!.createdAt.getTime()).toBeLessThanOrEqual(list[1]!.createdAt.getTime());
  });
});

describe('DrizzleJobEnqueuer', () => {
  it('should enqueue one job per inbound and no-op on a repeat', async () => {
    const { conversationId, messageId } = await seedInbound();
    const enqueue = (): Promise<void> =>
      uow.run((tx) => jobs.enqueueInTx(tx, { inboundMessageId: messageId, conversationId }));
    await enqueue();
    await enqueue();
    const rows = await client.sql<{ count: number }[]>`
      select count(*)::int as count from jobs where inbound_message_id = ${messageId}`;
    expect(rows[0]?.count).toBe(1);
  });

  it('should discard the job when the caller transaction rolls back', async () => {
    const { conversationId, messageId } = await seedInbound();
    await expect(
      uow.run(async (tx) => {
        await jobs.enqueueInTx(tx, { inboundMessageId: messageId, conversationId });
        throw new Error('rollback');
      }),
    ).rejects.toThrow('rollback');
    const rows = await client.sql<{ count: number }[]>`
      select count(*)::int as count from jobs where inbound_message_id = ${messageId}`;
    expect(rows[0]?.count).toBe(0);
  });
});

describe('PgNotifier', () => {
  it('should emit a notification inside a transaction without error', async () => {
    await expect(uow.run((tx) => notifier.jobCreated(tx))).resolves.toBeUndefined();
  });
});
