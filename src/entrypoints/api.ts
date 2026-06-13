import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { IngestInboundMessage } from '../application/ingest-inbound-message.js';
import { GetConversationDetail } from '../application/use-cases/get-conversation-detail.js';
import { ListConversations } from '../application/use-cases/list-conversations.js';
import { SendOutboundMessage } from '../application/use-cases/send-outbound-message.js';
import { loadConfig, smsProvider } from '../infrastructure/config.js';
import { createDbClient } from '../infrastructure/db/client.js';
import { DrizzleUnitOfWork } from '../infrastructure/db/unit-of-work.js';
import { PgEventBus } from '../infrastructure/events/pg-event-bus.js';
import { createLogger } from '../infrastructure/logging/logger.js';
import { DrizzleConversationRepository } from '../infrastructure/repositories/conversation-repository.js';
import { PgHealthRepository } from '../infrastructure/repositories/health-repository.js';
import { DrizzleJobEnqueuer } from '../infrastructure/repositories/job-enqueuer.js';
import { DrizzleMessageRepository } from '../infrastructure/repositories/message-repository.js';
import { PgNotifier } from '../infrastructure/repositories/notifier.js';
import { DrizzleWebhookEventRepository } from '../infrastructure/repositories/webhook-event-repository.js';
import { createSmsProvider } from '../infrastructure/sms/create-sms-provider.js';
import { TwilioSignatureVerifier } from '../infrastructure/sms/twilio-signature-verifier.js';
import { buildServer } from '../http/server.js';

// The system number outbound sends are addressed from; the Twilio number when set.
const DEFAULT_SYSTEM_PHONE = '+10000000000';

async function main(): Promise<void> {
  const config = loadConfig();
  const logger = createLogger({ level: config.LOG_LEVEL, service: 'api' });
  const { sql, db } = createDbClient(config.DATABASE_URL);
  const conversations = new DrizzleConversationRepository(db);
  const messages = new DrizzleMessageRepository(db);
  const eventBus = new PgEventBus(sql);

  try {
    await eventBus.start();

    const ingestInboundMessage = new IngestInboundMessage(
      new DrizzleUnitOfWork(db),
      new DrizzleWebhookEventRepository(),
      conversations,
      messages,
      new DrizzleJobEnqueuer(),
      new PgNotifier(),
      logger,
    );

    const verifier =
      config.SMS_PROVIDER === smsProvider.twilio && config.TWILIO_AUTH_TOKEN
        ? new TwilioSignatureVerifier(config.TWILIO_AUTH_TOKEN)
        : undefined;

    const sendOutboundMessage = new SendOutboundMessage(
      new DrizzleUnitOfWork(db),
      conversations,
      messages,
      await createSmsProvider(config),
      new PgNotifier(),
      config.TWILIO_FROM_NUMBER ?? DEFAULT_SYSTEM_PHONE,
      logger,
    );

    // Serve the built admin when present (the image); absent in local tsx dev, where it runs via vite.
    const adminDir = fileURLToPath(new URL('../../admin/dist', import.meta.url));
    const adminReady = existsSync(join(adminDir, 'index.html'));

    const app = buildServer({
      listConversations: new ListConversations(conversations),
      getConversationDetail: new GetConversationDetail(conversations, messages),
      ingestInboundMessage,
      sendOutboundMessage,
      verifier,
      trustProxy: config.TRUST_PROXY,
      adminDir: adminReady ? adminDir : undefined,
      eventBus,
      heartbeatMs: config.SSE_HEARTBEAT_MS,
      loggerInstance: logger,
      healthRepository: new PgHealthRepository(sql),
      smsProvider: config.SMS_PROVIDER,
      simulate: config.SMS_PROVIDER === smsProvider.mock ? { ingestInboundMessage } : null,
    });

    app.addHook('onClose', async () => {
      try {
        await eventBus.close();
      } finally {
        await sql.end();
      }
    });
    for (const signal of ['SIGTERM', 'SIGINT'] as const) {
      process.on(signal, () => {
        void app.close();
      });
    }

    await app.listen({ port: config.API_PORT, host: '0.0.0.0' });
    logger.info({ event: 'listening', port: config.API_PORT });
  } catch (error) {
    // The server's onClose only runs post-listen, so free these handles on a startup failure.
    await eventBus.close().catch(() => {});
    await sql.end().catch(() => {});
    throw error;
  }
}

try {
  await main();
} catch (error) {
  process.exitCode = 1;
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
}
