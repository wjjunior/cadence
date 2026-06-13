import { randomUUID } from 'node:crypto';

import { conversationKey } from '../../domain/conversation.js';
import { type OutboundStatus, outboundStatus, transitionOutbound } from '../../domain/status.js';
import type { SendMessage } from '../contracts/send-message.js';
import type { ConversationRepository } from '../ports/conversation-repository.js';
import type { Logger } from '../ports/logger.js';
import type { MessageRepository } from '../ports/message-repository.js';
import type { Notifier } from '../ports/notifier.js';
import type { SmsProvider } from '../ports/sms-provider.js';
import type { UnitOfWork } from '../ports/tx.js';

export type SendOutboundResult =
  | { outcome: 'duplicate' }
  | { outcome: 'sent'; messageId: string; conversationId: string; idempotencyKey: string }
  | { outcome: 'failed'; messageId: string; conversationId: string; errorDetail: string };

function walkOutbound(end: OutboundStatus): OutboundStatus {
  return transitionOutbound(transitionOutbound(outboundStatus.queued, outboundStatus.sending), end);
}

export class SendOutboundMessage {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly conversations: ConversationRepository,
    private readonly messages: MessageRepository,
    private readonly smsProvider: SmsProvider,
    private readonly notifier: Notifier,
    private readonly systemPhone: string,
    private readonly logger: Logger,
  ) {}

  async execute(command: SendMessage): Promise<SendOutboundResult> {
    const key = conversationKey(command.to, this.systemPhone);
    const idempotencyKey = command.idempotencyKey ?? `manual:${randomUUID()}`;

    const created = await this.uow.run(async (tx) => {
      const conversation = await this.conversations.upsert(tx, key);
      const message = await this.messages.insertOutboundIfNew(tx, {
        conversationId: conversation.id,
        body: command.body,
        idempotencyKey,
        inReplyTo: null,
        providerMessageSid: null,
      });
      return message ? { conversation, message } : null;
    });

    if (!created) {
      this.logger.info({ event: 'outbound_send_duplicate', idempotencyKey });
      return { outcome: 'duplicate' };
    }

    const { conversation, message } = created;
    // Only the provider send decides failed; a commit error after a delivered send must not relabel it.
    try {
      await this.smsProvider.send({
        to: conversation.userPhone,
        from: conversation.systemPhone,
        body: command.body,
        idempotencyKey,
      });
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      await this.uow.run(async (tx) => {
        await this.messages.markStatus(tx, message.id, walkOutbound(outboundStatus.failed), detail);
        await this.notifier.conversationChanged(tx, conversation.id);
      });
      this.logger.warn({
        event: 'outbound_send_failed',
        conversationId: conversation.id,
        messageId: message.id,
        error: detail,
      });
      return {
        outcome: 'failed',
        messageId: message.id,
        conversationId: conversation.id,
        errorDetail: detail,
      };
    }

    await this.uow.run(async (tx) => {
      await this.messages.markStatus(tx, message.id, walkOutbound(outboundStatus.sent));
      await this.notifier.conversationChanged(tx, conversation.id);
    });
    this.logger.info({
      event: 'outbound_sent',
      conversationId: conversation.id,
      messageId: message.id,
    });
    return {
      outcome: 'sent',
      messageId: message.id,
      conversationId: conversation.id,
      idempotencyKey,
    };
  }
}
