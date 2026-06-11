import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { IngestInboundMessage } from '../../src/application/ingest-inbound-message.js';
import { GetConversationDetail } from '../../src/application/use-cases/get-conversation-detail.js';
import { ListConversations } from '../../src/application/use-cases/list-conversations.js';
import { type DbClient, createDbClient } from '../../src/infrastructure/db/client.js';
import { runMigrations } from '../../src/infrastructure/db/migrator.js';
import { DrizzleUnitOfWork } from '../../src/infrastructure/db/unit-of-work.js';
import { PgEventBus } from '../../src/infrastructure/events/pg-event-bus.js';
import { DrizzleConversationRepository } from '../../src/infrastructure/repositories/conversation-repository.js';
import { DrizzleJobEnqueuer } from '../../src/infrastructure/repositories/job-enqueuer.js';
import { DrizzleMessageRepository } from '../../src/infrastructure/repositories/message-repository.js';
import { PgHealthRepository } from '../../src/infrastructure/repositories/health-repository.js';
import { PgNotifier } from '../../src/infrastructure/repositories/notifier.js';
import { DrizzleWebhookEventRepository } from '../../src/infrastructure/repositories/webhook-event-repository.js';
import { type ServerDeps, buildServer } from '../../src/http/server.js';

const HEARTBEAT_MS = 80;
const CID = 'c0000000-0000-4000-8000-000000000001';

let container: StartedPostgreSqlContainer;
let client: DbClient;
let bus: PgEventBus;
let notifier: PgNotifier;
let uow: DrizzleUnitOfWork;
let app: FastifyInstance;
let base: string;

class SseClient {
  private res!: Response;
  private readonly controller = new AbortController();
  private readonly frames: string[] = [];
  private waiters: Array<{ pred: (f: string) => boolean; resolve: (f: string) => void }> = [];

  async connect(url: string): Promise<void> {
    this.res = await fetch(url, {
      headers: { accept: 'text/event-stream' },
      signal: this.controller.signal,
    });
    void this.readLoop();
  }

  private async readLoop(): Promise<void> {
    const reader = this.res.body!.getReader();
    const decoder = new TextDecoder();
    let buf = '';
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) return;
        buf += decoder.decode(value, { stream: true });
        let idx: number;
        while ((idx = buf.indexOf('\n\n')) !== -1) {
          this.push(buf.slice(0, idx));
          buf = buf.slice(idx + 2);
        }
      }
    } catch {
      // aborted
    }
  }

  private push(frame: string): void {
    this.frames.push(frame);
    this.waiters = this.waiters.filter((w) => {
      if (!w.pred(frame)) return true;
      w.resolve(frame);
      return false;
    });
  }

  waitFor(pred: (f: string) => boolean, timeoutMs = 1_000): Promise<string> {
    const existing = this.frames.find(pred);
    if (existing) return Promise.resolve(existing);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('timeout waiting for SSE frame')), timeoutMs);
      this.waiters.push({
        pred,
        resolve: (f) => {
          clearTimeout(timer);
          resolve(f);
        },
      });
    });
  }

  get contentType(): string | null {
    return this.res.headers.get('content-type');
  }

  close(): void {
    this.controller.abort();
  }
}

const isData = (f: string): boolean => f.startsWith('data:');
const isHandshake = (f: string): boolean => f.startsWith(':');
const isHeartbeat = (f: string): boolean => f.startsWith(':keep-alive');
const parseData = (frame: string): { type: string; conversationId: string } =>
  JSON.parse(frame.slice('data: '.length));

async function emitChange(conversationId: string): Promise<void> {
  await uow.run((tx) => notifier.conversationChanged(tx, conversationId));
}

beforeAll(async () => {
  container = await new PostgreSqlContainer('postgres:16').start();
  const url = container.getConnectionUri();
  await runMigrations(url);
  client = createDbClient(url, { max: 8 });
  uow = new DrizzleUnitOfWork(client.db);
  notifier = new PgNotifier();
  bus = new PgEventBus(client.sql);
  await bus.start();

  app = buildServer(makeServerDeps());
  base = await app.listen({ port: 0, host: '127.0.0.1' });
});

function makeServerDeps(): ServerDeps {
  const conversations = new DrizzleConversationRepository(client.db);
  const messages = new DrizzleMessageRepository(client.db);
  return {
    listConversations: new ListConversations(conversations),
    getConversationDetail: new GetConversationDetail(conversations, messages),
    ingestInboundMessage: new IngestInboundMessage(
      uow,
      new DrizzleWebhookEventRepository(),
      conversations,
      messages,
      new DrizzleJobEnqueuer(),
      notifier,
    ),
    eventBus: bus,
    heartbeatMs: HEARTBEAT_MS,
    healthRepository: new PgHealthRepository(client.sql),
  };
}

afterAll(async () => {
  await app?.close();
  await bus?.close();
  try {
    await client?.sql?.end();
  } finally {
    await container?.stop();
  }
});

describe('GET /api/events', () => {
  it('should stream SSE framing with a text/event-stream content type', async () => {
    const c = new SseClient();
    await c.connect(`${base}/api/events`);

    await c.waitFor(isHandshake);
    expect(c.contentType).toContain('text/event-stream');
    c.close();
  });

  it('should deliver a conversation change to a connected client within 1s carrying the id', async () => {
    const c = new SseClient();
    await c.connect(`${base}/api/events`);
    await c.waitFor(isHandshake);

    await emitChange(CID);

    const frame = await c.waitFor(isData, 1_000);
    expect(parseData(frame)).toEqual({ type: 'conversation.changed', conversationId: CID });
    c.close();
  });

  it('should send periodic heartbeats', async () => {
    const c = new SseClient();
    await c.connect(`${base}/api/events`);

    await c.waitFor(isHeartbeat, 1_000);
    c.close();
  });

  it('should close the server even while a client is still connected', async () => {
    const extra = buildServer(makeServerDeps());
    const addr = await extra.listen({ port: 0, host: '127.0.0.1' });
    const c = new SseClient();
    await c.connect(`${addr}/api/events`);
    await c.waitFor(isHandshake);

    const timeout = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('app.close() hung with a client connected')), 2_000),
    );
    await Promise.race([extra.close(), timeout]);

    c.close();
  });

  it('should keep serving other clients after one disconnects', async () => {
    const a = new SseClient();
    const b = new SseClient();
    await a.connect(`${base}/api/events`);
    await b.connect(`${base}/api/events`);
    await a.waitFor(isHandshake);
    await b.waitFor(isHandshake);

    a.close();
    await new Promise((r) => setTimeout(r, 50));
    await emitChange(CID);

    const frame = await b.waitFor(isData, 1_000);
    expect(parseData(frame).conversationId).toBe(CID);
    b.close();
  });
});
