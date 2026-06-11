import { conversationKey } from '../domain/conversation.js';
import type { IngestInboundCommand } from './contracts/ingest-command.js';
import type { ConversationRepository } from './ports/conversation-repository.js';
import type { JobEnqueuer } from './ports/job-queue.js';
import type { MessageRepository } from './ports/message-repository.js';
import type { Notifier } from './ports/notifier.js';
import type { UnitOfWork } from './ports/tx.js';
import type { WebhookEventRepository } from './ports/webhook-event-repository.js';

export type IngestResult =
  | { duplicate: true }
  | { duplicate: false; conversationId: string; messageId: string };

export class IngestInboundMessage {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly webhookEvents: WebhookEventRepository,
    private readonly conversations: ConversationRepository,
    private readonly messages: MessageRepository,
    private readonly jobs: JobEnqueuer,
    private readonly notifier: Notifier,
  ) {}

  async execute(command: IngestInboundCommand, rawPayload: unknown): Promise<IngestResult> {
    // Normalized before the transaction so a malformed phone fails fast with nothing opened.
    const key = conversationKey(command.from, command.to);
    return this.uow.run(async (tx) => {
      const { inserted } = await this.webhookEvents.insertIgnoringDuplicate(
        tx,
        command.providerSid,
        rawPayload,
      );
      if (!inserted) return { duplicate: true };

      const conversation = await this.conversations.upsert(tx, key);
      const message = await this.messages.insertInbound(tx, {
        conversationId: conversation.id,
        body: command.body,
        providerMessageSid: command.providerSid,
      });
      await this.jobs.enqueueInTx(tx, {
        inboundMessageId: message.id,
        conversationId: conversation.id,
      });
      await this.notifier.jobCreated(tx);

      return { duplicate: false, conversationId: conversation.id, messageId: message.id };
    });
  }
}
