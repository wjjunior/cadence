import { randomUUID } from 'node:crypto';

import type { FastifyInstance } from 'fastify';

import { errorResponse } from '../../application/contracts/error-response.js';
import { SimulateInbound } from '../../application/contracts/simulate.js';
import type { IngestInboundMessage } from '../../application/ingest-inbound-message.js';
import { InvalidPhoneNumberError } from '../../domain/conversation.js';

const SIMULATE_SYSTEM_PHONE = '+10000000000';

export interface SimulateRoutesDeps {
  ingestInboundMessage: IngestInboundMessage;
}

export function registerSimulateRoutes(app: FastifyInstance, deps: SimulateRoutesDeps): void {
  app.post('/dev/simulate-inbound', async (request, reply) => {
    const parsed = SimulateInbound.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send(errorResponse('invalid simulate payload'));
    }
    const command = {
      from: parsed.data.from,
      to: SIMULATE_SYSTEM_PHONE,
      body: parsed.data.body,
      providerSid: `sim:${randomUUID()}`,
    };
    try {
      const result = await deps.ingestInboundMessage.execute(command, command);
      return reply.code(200).send(result);
    } catch (error) {
      if (error instanceof InvalidPhoneNumberError) {
        return reply.code(400).send(errorResponse('invalid phone number'));
      }
      throw error;
    }
  });
}
