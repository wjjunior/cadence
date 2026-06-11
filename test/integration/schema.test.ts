import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type DbClient, createDbClient } from '../../src/infrastructure/db/client.js';
import { runMigrations } from '../../src/infrastructure/db/migrator.js';

const UNIQUE_VIOLATION = '23505';
const CHECK_VIOLATION = '23514';

let container: StartedPostgreSqlContainer;
let sql: DbClient['sql'];
let seq = 0;
const uniq = (): string => `${++seq}`;

beforeAll(async () => {
  container = await new PostgreSqlContainer('postgres:16').start();
  const url = container.getConnectionUri();
  await runMigrations(url);
  sql = createDbClient(url, { max: 1 }).sql;
});

afterAll(async () => {
  try {
    await sql?.end();
  } finally {
    await container?.stop();
  }
});

async function newConversation(): Promise<string> {
  const n = uniq();
  const rows = await sql<{ id: string }[]>`
    insert into conversations (user_phone, system_phone)
    values (${`user-${n}`}, ${`system-${n}`})
    returning id`;
  const row = rows[0];
  if (!row) throw new Error('conversation insert returned no row');
  return row.id;
}

async function newInboundMessage(conversationId: string, sid: string | null = null): Promise<string> {
  const rows = await sql<{ id: string }[]>`
    insert into messages (conversation_id, direction, body, status, provider_message_sid)
    values (${conversationId}, 'inbound', 'hi', 'received', ${sid})
    returning id`;
  const row = rows[0];
  if (!row) throw new Error('message insert returned no row');
  return row.id;
}

async function expectSqlState(
  fn: () => Promise<unknown>,
  code: string,
  constraintName?: string,
): Promise<void> {
  let succeeded = false;
  let caught: unknown;
  try {
    await fn();
    succeeded = true;
  } catch (error) {
    caught = error;
  }
  expect(succeeded, `expected SQLSTATE ${code} but the statement succeeded`).toBe(false);
  const err = caught as { code?: string; constraint_name?: string };
  expect(err.code, `unexpected error: ${String(caught)}`).toBe(code);
  if (constraintName) {
    expect(err.constraint_name).toBe(constraintName);
  }
}

describe('schema migration', () => {
  it('is idempotent on re-run against an already-migrated database', async () => {
    await expect(runMigrations(container.getConnectionUri())).resolves.toBeUndefined();
  });

  it('creates the idempotency and serialization indexes', async () => {
    const rows = await sql<{ indexname: string }[]>`
      select indexname from pg_indexes where schemaname = 'public'`;
    const names = rows.map((r) => r.indexname);
    expect(names).toEqual(
      expect.arrayContaining([
        'one_running_per_conversation',
        'messages_inbound_sid',
        'messages_outbound_key',
        'jobs_claim',
        'jobs_conversation_open',
        'messages_conversation',
      ]),
    );
  });
});

describe('idempotency constraints', () => {
  it('rejects a duplicate inbound provider_message_sid', async () => {
    const conversationId = await newConversation();
    await newInboundMessage(conversationId, 'SM-dup');
    await expectSqlState(
      () => newInboundMessage(conversationId, 'SM-dup'),
      UNIQUE_VIOLATION,
      'messages_inbound_sid',
    );
  });

  it('allows the same sid on an outbound row (the inbound index is partial)', async () => {
    const conversationId = await newConversation();
    await newInboundMessage(conversationId, 'SM-shared');
    await expect(
      sql`insert into messages (conversation_id, direction, body, status, provider_message_sid)
          values (${conversationId}, 'outbound', 'reply', 'queued', 'SM-shared')`,
    ).resolves.toBeDefined();
  });

  it('rejects a duplicate outbound idempotency_key', async () => {
    const conversationId = await newConversation();
    const insertOutbound = (key: string): Promise<unknown> =>
      sql`insert into messages (conversation_id, direction, body, status, idempotency_key)
          values (${conversationId}, 'outbound', 'reply', 'queued', ${key})`;
    await insertOutbound('reply:abc');
    await expectSqlState(() => insertOutbound('reply:abc'), UNIQUE_VIOLATION, 'messages_outbound_key');
  });
});

describe('per-conversation serialization', () => {
  it('rejects a second concurrent running job for the same conversation', async () => {
    const conversationId = await newConversation();
    const m1 = await newInboundMessage(conversationId);
    const m2 = await newInboundMessage(conversationId);
    const insertJob = (messageId: string, status: string): Promise<unknown> =>
      sql`insert into jobs (inbound_message_id, conversation_id, status)
          values (${messageId}, ${conversationId}, ${status})`;

    await insertJob(m1, 'running');
    await expectSqlState(
      () => insertJob(m2, 'running'),
      UNIQUE_VIOLATION,
      'one_running_per_conversation',
    );
  });

  it('allows multiple pending jobs for the same conversation', async () => {
    const conversationId = await newConversation();
    const m1 = await newInboundMessage(conversationId);
    const m2 = await newInboundMessage(conversationId);
    const insertJob = (messageId: string): Promise<unknown> =>
      sql`insert into jobs (inbound_message_id, conversation_id, status)
          values (${messageId}, ${conversationId}, 'pending')`;

    await insertJob(m1);
    await expect(insertJob(m2)).resolves.toBeDefined();
  });
});

describe('check constraints', () => {
  it('rejects an invalid message direction', async () => {
    const conversationId = await newConversation();
    await expectSqlState(
      () =>
        sql`insert into messages (conversation_id, direction, body, status)
            values (${conversationId}, 'sideways', 'x', 'received')`,
      CHECK_VIOLATION,
      'messages_direction_check',
    );
  });

  it('rejects an invalid message status', async () => {
    const conversationId = await newConversation();
    await expectSqlState(
      () =>
        sql`insert into messages (conversation_id, direction, body, status)
            values (${conversationId}, 'inbound', 'x', 'bogus')`,
      CHECK_VIOLATION,
      'messages_status_check',
    );
  });

  it('rejects an invalid job status', async () => {
    const conversationId = await newConversation();
    const messageId = await newInboundMessage(conversationId);
    await expectSqlState(
      () =>
        sql`insert into jobs (inbound_message_id, conversation_id, status)
            values (${messageId}, ${conversationId}, 'bogus')`,
      CHECK_VIOLATION,
      'jobs_status_check',
    );
  });
});
