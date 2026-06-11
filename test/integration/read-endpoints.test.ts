import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { ConversationListPage, ConversationDetail } from '../../src/application/contracts/admin-dto.js';
import { GetConversationDetail } from '../../src/application/use-cases/get-conversation-detail.js';
import { ListConversations } from '../../src/application/use-cases/list-conversations.js';
import { type DbClient, createDbClient } from '../../src/infrastructure/db/client.js';
import { runMigrations } from '../../src/infrastructure/db/migrator.js';
import { DrizzleConversationRepository } from '../../src/infrastructure/repositories/conversation-repository.js';
import { DrizzleMessageRepository } from '../../src/infrastructure/repositories/message-repository.js';
import { buildServer } from '../../src/http/server.js';

let container: StartedPostgreSqlContainer;
let client: DbClient;
let sql: DbClient['sql'];
let app: FastifyInstance;

beforeAll(async () => {
  container = await new PostgreSqlContainer('postgres:16').start();
  const url = container.getConnectionUri();
  await runMigrations(url);
  client = createDbClient(url, { max: 6 });
  sql = client.sql;
  const conversations = new DrizzleConversationRepository(client.db);
  const messages = new DrizzleMessageRepository(client.db);
  app = buildServer({
    listConversations: new ListConversations(conversations),
    getConversationDetail: new GetConversationDetail(conversations, messages),
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
  await sql`truncate jobs, messages, conversations restart identity cascade`;
});

let seq = 0;
async function seedConversation(offsetSeconds: number): Promise<string> {
  const n = `${Date.now()}-${++seq}`;
  const rows = await sql<{ id: string }[]>`
    insert into conversations (user_phone, system_phone, last_message_at)
    values (${`u-${n}`}, ${`s-${n}`}, now() - ${`${offsetSeconds} seconds`}::interval)
    returning id`;
  return rows[0]!.id;
}

describe('GET /api/conversations', () => {
  it('should list conversations ordered by recency and paginate via nextCursor', async () => {
    const recent = await seedConversation(0);
    const middle = await seedConversation(60);
    const oldest = await seedConversation(120);

    const first = await app.inject({ url: '/api/conversations?limit=2' });
    expect(first.statusCode).toBe(200);
    const page1 = first.json<ConversationListPage>();
    expect(page1.items.map((c) => c.id)).toEqual([recent, middle]);
    expect(page1.nextCursor).not.toBeNull();

    const second = await app.inject({
      url: `/api/conversations?limit=2&cursor=${encodeURIComponent(page1.nextCursor!)}`,
    });
    const page2 = second.json<ConversationListPage>();
    expect(page2.items.map((c) => c.id)).toEqual([oldest]);
    expect(page2.nextCursor).toBeNull();
  });

  it('should treat an empty cursor the same as omitting it (first page)', async () => {
    await seedConversation(0);
    const res = await app.inject({ url: '/api/conversations?cursor=&limit=2' });
    expect(res.statusCode).toBe(200);
    expect(res.json<ConversationListPage>().items.length).toBeGreaterThan(0);
  });

  it('should return 400 for an invalid limit', async () => {
    const res = await app.inject({ url: '/api/conversations?limit=0' });
    expect(res.statusCode).toBe(400);
  });

  it('should return 400 for a garbage cursor', async () => {
    const res = await app.inject({ url: '/api/conversations?cursor=not-a-cursor' });
    expect(res.statusCode).toBe(400);
  });
});

describe('GET /api/conversations/:id/messages', () => {
  it('should return the full history with status, direction and error_detail', async () => {
    const conversationId = await seedConversation(0);
    await sql`insert into messages (conversation_id, direction, body, status)
              values (${conversationId}, 'inbound', 'hi', 'processed')`;
    await sql`insert into messages (conversation_id, direction, body, status, error_detail)
              values (${conversationId}, 'outbound', 'reply', 'failed', 'provider down')`;

    const res = await app.inject({ url: `/api/conversations/${conversationId}/messages` });
    expect(res.statusCode).toBe(200);
    const detail = res.json<ConversationDetail>();
    expect(detail.id).toBe(conversationId);
    expect(detail.messages).toHaveLength(2);
    const failed = detail.messages.find((m) => m.status === 'failed');
    expect(failed).toMatchObject({ direction: 'outbound', errorDetail: 'provider down' });
  });

  it('should return 404 for an unknown conversation', async () => {
    const res = await app.inject({
      url: '/api/conversations/99999999-9999-4999-8999-999999999999/messages',
    });
    expect(res.statusCode).toBe(404);
  });

  it('should return 400 for a non-uuid conversation id', async () => {
    const res = await app.inject({ url: '/api/conversations/not-a-uuid/messages' });
    expect(res.statusCode).toBe(400);
  });
});
