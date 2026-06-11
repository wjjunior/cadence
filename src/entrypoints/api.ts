import { IngestInboundMessage } from '../application/ingest-inbound-message.js';
import { GetConversationDetail } from '../application/use-cases/get-conversation-detail.js';
import { ListConversations } from '../application/use-cases/list-conversations.js';
import { loadConfig } from '../infrastructure/config.js';
import { createDbClient } from '../infrastructure/db/client.js';
import { DrizzleUnitOfWork } from '../infrastructure/db/unit-of-work.js';
import { DrizzleConversationRepository } from '../infrastructure/repositories/conversation-repository.js';
import { DrizzleJobEnqueuer } from '../infrastructure/repositories/job-enqueuer.js';
import { DrizzleMessageRepository } from '../infrastructure/repositories/message-repository.js';
import { PgNotifier } from '../infrastructure/repositories/notifier.js';
import { DrizzleWebhookEventRepository } from '../infrastructure/repositories/webhook-event-repository.js';
import { buildServer } from '../http/server.js';

async function main(): Promise<void> {
  const config = loadConfig();
  const { db } = createDbClient(config.DATABASE_URL);
  const conversations = new DrizzleConversationRepository(db);
  const messages = new DrizzleMessageRepository(db);

  const ingestInboundMessage = new IngestInboundMessage(
    new DrizzleUnitOfWork(db),
    new DrizzleWebhookEventRepository(),
    conversations,
    messages,
    new DrizzleJobEnqueuer(),
    new PgNotifier(),
  );

  const app = buildServer({
    listConversations: new ListConversations(conversations),
    getConversationDetail: new GetConversationDetail(conversations, messages),
    ingestInboundMessage,
  });

  await app.listen({ port: config.API_PORT, host: '0.0.0.0' });
  process.stdout.write(
    `${JSON.stringify({ service: 'api', event: 'listening', port: config.API_PORT })}\n`,
  );
}

main().catch((error) => {
  process.exitCode = 1;
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
});
