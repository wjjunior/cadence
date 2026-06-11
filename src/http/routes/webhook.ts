import type { FastifyInstance } from 'fastify';

import { errorResponse } from '../../application/contracts/error-response.js';
import { TwilioInboundWebhook } from '../../application/contracts/twilio-webhook.js';
import type { IngestInboundMessage } from '../../application/ingest-inbound-message.js';
import { InvalidPhoneNumberError } from '../../domain/conversation.js';

const EMPTY_TWIML = '<Response/>';

export interface WebhookRoutesDeps {
  ingestInboundMessage: IngestInboundMessage;
}

export function registerWebhookRoutes(app: FastifyInstance, deps: WebhookRoutesDeps): void {
  app.post('/webhooks/twilio/sms', async (request, reply) => {
    const parsed = TwilioInboundWebhook.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send(errorResponse('invalid webhook payload'));
    }
    try {
      await deps.ingestInboundMessage.execute(parsed.data, request.body);
    } catch (error) {
      // A non-empty but non-E.164 phone is a malformed payload, rejected before the
      // transaction opens — so 400, not a 5xx that would trigger Twilio retries.
      if (error instanceof InvalidPhoneNumberError) {
        return reply.code(400).send(errorResponse('invalid phone number'));
      }
      throw error;
    }
    return reply.code(200).type('text/xml').send(EMPTY_TWIML);
  });
}
