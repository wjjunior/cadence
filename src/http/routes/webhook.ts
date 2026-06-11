import type { FastifyInstance } from 'fastify';

import { errorResponse } from '../../application/contracts/error-response.js';
import { TwilioInboundWebhook } from '../../application/contracts/twilio-webhook.js';
import type { IngestInboundMessage } from '../../application/ingest-inbound-message.js';

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
    await deps.ingestInboundMessage.execute(parsed.data, request.body);
    return reply.code(200).type('text/xml').send(EMPTY_TWIML);
  });
}
