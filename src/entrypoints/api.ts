import { GetConversationDetail } from '../application/use-cases/get-conversation-detail.js';
import { ListConversations } from '../application/use-cases/list-conversations.js';
import { loadConfig } from '../infrastructure/config.js';
import { createDbClient } from '../infrastructure/db/client.js';
import { PgEventBus } from '../infrastructure/events/pg-event-bus.js';
import { DrizzleConversationRepository } from '../infrastructure/repositories/conversation-repository.js';
import { DrizzleMessageRepository } from '../infrastructure/repositories/message-repository.js';
import { buildServer } from '../http/server.js';

async function main(): Promise<void> {
  const config = loadConfig();
  const { sql, db } = createDbClient(config.DATABASE_URL);
  const conversations = new DrizzleConversationRepository(db);
  const messages = new DrizzleMessageRepository(db);

  const eventBus = new PgEventBus(sql);
  await eventBus.start();

  const app = buildServer({
    listConversations: new ListConversations(conversations),
    getConversationDetail: new GetConversationDetail(conversations, messages),
    eventBus,
    heartbeatMs: config.SSE_HEARTBEAT_MS,
  });

  app.addHook('onClose', async () => {
    await eventBus.close();
    await sql.end();
  });
  for (const signal of ['SIGTERM', 'SIGINT'] as const) {
    process.on(signal, () => {
      void app.close();
    });
  }

  await app.listen({ port: config.API_PORT, host: '0.0.0.0' });
  process.stdout.write(
    `${JSON.stringify({ service: 'api', event: 'listening', port: config.API_PORT })}\n`,
  );
}

main().catch((error) => {
  process.exitCode = 1;
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
});
