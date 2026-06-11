import type { FastifyInstance } from 'fastify';

import { IngestInboundMessage } from '../../../src/application/ingest-inbound-message.js';
import type { EventBus } from '../../../src/application/ports/event-bus.js';
import { GetConversationDetail } from '../../../src/application/use-cases/get-conversation-detail.js';
import { ListConversations } from '../../../src/application/use-cases/list-conversations.js';
import type { DbClient } from '../../../src/infrastructure/db/client.js';
import { DrizzleUnitOfWork } from '../../../src/infrastructure/db/unit-of-work.js';
import { DrizzleConversationRepository } from '../../../src/infrastructure/repositories/conversation-repository.js';
import { DrizzleHeartbeatRepository } from '../../../src/infrastructure/repositories/heartbeat-repository.js';
import { PgHealthRepository } from '../../../src/infrastructure/repositories/health-repository.js';
import { DrizzleJobEnqueuer } from '../../../src/infrastructure/repositories/job-enqueuer.js';
import { DrizzleMessageRepository } from '../../../src/infrastructure/repositories/message-repository.js';
import { PgNotifier } from '../../../src/infrastructure/repositories/notifier.js';
import { DrizzleWebhookEventRepository } from '../../../src/infrastructure/repositories/webhook-event-repository.js';
import { buildServer } from '../../../src/http/server.js';
import { silentLogger } from '../../helpers/silent-logger.js';

const noopEventBus: EventBus = { subscribe: () => () => {} };

export interface TestApp {
  app: FastifyInstance;
  heartbeats: DrizzleHeartbeatRepository;
}

export function buildTestApp(
  client: DbClient,
  opts: { simulate?: boolean; adminDir?: string } = {},
): TestApp {
  const conversations = new DrizzleConversationRepository(client.db);
  const messages = new DrizzleMessageRepository(client.db);
  const ingestInboundMessage = new IngestInboundMessage(
    new DrizzleUnitOfWork(client.db),
    new DrizzleWebhookEventRepository(),
    conversations,
    messages,
    new DrizzleJobEnqueuer(),
    new PgNotifier(),
    silentLogger,
  );

  const app = buildServer({
    listConversations: new ListConversations(conversations),
    getConversationDetail: new GetConversationDetail(conversations, messages),
    ingestInboundMessage,
    eventBus: noopEventBus,
    heartbeatMs: 30_000,
    healthRepository: new PgHealthRepository(client.sql),
    smsProvider: opts.simulate ? 'mock' : 'twilio',
    simulate: opts.simulate ? { ingestInboundMessage } : null,
    adminDir: opts.adminDir,
  });

  return { app, heartbeats: new DrizzleHeartbeatRepository(client.db) };
}
