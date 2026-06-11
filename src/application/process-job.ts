import { backoffDelay } from '../domain/backoff.js';
import { replyIdempotencyKey } from '../domain/idempotency.js';
import type { Job } from '../domain/job.js';
import {
  type OutboundStatus,
  inboundStatus,
  messageDirection,
  outboundStatus,
  transitionInbound,
  transitionOutbound,
} from '../domain/status.js';
import type { ConversationRepository } from './ports/conversation-repository.js';
import type { WorkerQueue } from './ports/job-queue.js';
import type { MessageRepository } from './ports/message-repository.js';
import type { Notifier } from './ports/notifier.js';
import type { ReplyGenerator } from './ports/reply-generator.js';
import type { SmsProvider } from './ports/sms-provider.js';
import type { UnitOfWork } from './ports/tx.js';

export interface ProcessJobSettings {
  backoffBaseMs: number;
  backoffCapMs: number;
  now: () => Date;
  random: () => number;
}

// Validates the queued -> sending -> end path through the domain machine and returns the
// endpoint, so only legal terminal states (sent | failed) are persisted (sending is transient).
function walkOutbound(end: OutboundStatus): OutboundStatus {
  return transitionOutbound(
    transitionOutbound(outboundStatus.queued, outboundStatus.sending),
    end,
  );
}

export class ProcessJob {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly conversations: ConversationRepository,
    private readonly messages: MessageRepository,
    private readonly workerQueue: WorkerQueue,
    private readonly replyGenerator: ReplyGenerator,
    private readonly smsProvider: SmsProvider,
    private readonly notifier: Notifier,
    private readonly settings: ProcessJobSettings,
  ) {}

  async execute(job: Job): Promise<void> {
    let outboundToFail: string | undefined;
    try {
      const history = await this.messages.listByConversation(job.conversationId);
      const inbound = history.find((m) => m.id === job.inboundMessageId);
      if (!inbound) throw new Error(`inbound message ${job.inboundMessageId} not found`);
      outboundToFail = history.find(
        (m) => m.direction === messageDirection.outbound && m.inReplyTo === job.inboundMessageId,
      )?.id;

      if (inbound.status === inboundStatus.received) {
        await this.uow.run((tx) =>
          this.messages.markStatus(
            tx,
            inbound.id,
            transitionInbound(inboundStatus.received, inboundStatus.processing),
          ),
        );
      }

      const { body } = await this.replyGenerator.generate({
        conversationId: job.conversationId,
        inboundBody: inbound.body,
        history: history.filter((m) => m.id !== job.inboundMessageId),
      });

      const idempotencyKey = replyIdempotencyKey(job.inboundMessageId);
      const outbound = await this.uow.run((tx) =>
        this.messages.insertOutbound(tx, {
          conversationId: job.conversationId,
          body,
          idempotencyKey,
          inReplyTo: job.inboundMessageId,
          providerMessageSid: null,
        }),
      );
      outboundToFail = outbound.id;

      const conversation = await this.conversations.getById(job.conversationId);
      if (!conversation) throw new Error(`conversation ${job.conversationId} not found`);
      await this.smsProvider.send({
        to: conversation.userPhone,
        from: conversation.systemPhone,
        body,
        idempotencyKey,
      });

      await this.uow.run(async (tx) => {
        await this.messages.markStatus(tx, outbound.id, walkOutbound(outboundStatus.sent));
        await this.messages.markStatus(
          tx,
          inbound.id,
          transitionInbound(inboundStatus.processing, inboundStatus.processed),
        );
        await this.workerQueue.complete(tx, job.id);
        await this.conversations.touch(tx, job.conversationId);
        await this.notifier.conversationChanged(tx, job.conversationId);
      });
    } catch (error) {
      await this.handleFailure(job, error, outboundToFail);
    }
  }

  private async handleFailure(job: Job, error: unknown, outboundId: string | undefined): Promise<void> {
    const message = error instanceof Error ? error.message : String(error);
    const terminal = job.attempts >= job.maxAttempts;
    const retryAt = terminal
      ? null
      : new Date(
          this.settings.now().getTime() +
            backoffDelay(job.attempts, this.settings.backoffBaseMs, this.settings.backoffCapMs, this.settings.random()),
        );

    await this.uow.run(async (tx) => {
      await this.workerQueue.fail(tx, job.id, message, retryAt);
      if (!terminal) return;
      await this.messages.markStatus(
        tx,
        job.inboundMessageId,
        transitionInbound(inboundStatus.processing, inboundStatus.failed),
        message,
      );
      if (outboundId) {
        await this.messages.markStatus(tx, outboundId, walkOutbound(outboundStatus.failed), message);
      }
      await this.notifier.conversationChanged(tx, job.conversationId);
    });
  }
}
