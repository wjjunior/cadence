import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';

import { errorResponse } from '../../application/contracts/error-response.js';
import { TwilioInboundWebhook } from '../../application/contracts/twilio-webhook.js';
import type { IngestInboundMessage } from '../../application/ingest-inbound-message.js';
import type { WebhookVerifier } from '../../application/ports/webhook-verifier.js';
import { InvalidPhoneNumberError } from '../../domain/conversation.js';

const EMPTY_TWIML = '<Response/>';
const formParams = z.record(z.string(), z.string()).catch({});

export interface WebhookRoutesDeps {
  ingestInboundMessage: IngestInboundMessage;
  // Present only in twilio mode; absent in mock mode (no signature required).
  verifier?: WebhookVerifier;
}

function buildVerifyPreHandler(verifier: WebhookVerifier) {
  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const header = request.headers['x-twilio-signature'];
    const ok = verifier.verify({
      signature: typeof header === 'string' ? header : undefined,
      url: `${request.protocol}://${request.host}${request.url}`,
      params: formParams.parse(request.body),
    });
    if (!ok) {
      await reply.code(403).send(errorResponse('invalid signature'));
    }
  };
}

export function registerWebhookRoutes(app: FastifyInstance, deps: WebhookRoutesDeps): void {
  const preHandler = deps.verifier ? buildVerifyPreHandler(deps.verifier) : undefined;

  app.post('/webhooks/twilio/sms', { preHandler }, async (request, reply) => {
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
