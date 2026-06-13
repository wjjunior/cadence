import type { FastifyInstance } from 'fastify';

import { errorResponse } from '../../application/contracts/error-response.js';
import { SendMessage } from '../../application/contracts/send-message.js';
import type { SendOutboundMessage } from '../../application/use-cases/send-outbound-message.js';
import { InvalidPhoneNumberError } from '../../domain/conversation.js';
import { outboundStatus } from '../../domain/status.js';

export interface MessageRoutesDeps {
  sendOutboundMessage: SendOutboundMessage;
}

export function registerMessageRoutes(app: FastifyInstance, deps: MessageRoutesDeps): void {
  app.post('/api/messages/send', async (request, reply) => {
    const parsed = SendMessage.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send(errorResponse('invalid send payload'));
    }
    try {
      const result = await deps.sendOutboundMessage.execute(parsed.data);
      if (result.outcome === 'duplicate') {
        return reply.code(200).send({ duplicate: true });
      }
      if (result.outcome === 'failed') {
        return reply.code(502).send({
          messageId: result.messageId,
          conversationId: result.conversationId,
          status: outboundStatus.failed,
          errorDetail: result.errorDetail,
        });
      }
      return reply.code(202).send({
        messageId: result.messageId,
        conversationId: result.conversationId,
        status: outboundStatus.sent,
        idempotencyKey: result.idempotencyKey,
      });
    } catch (error) {
      if (error instanceof InvalidPhoneNumberError) {
        return reply.code(400).send(errorResponse('invalid phone number'));
      }
      throw error;
    }
  });
}
