import formbody from '@fastify/formbody';
import fastifyStatic from '@fastify/static';
import Fastify, { type FastifyBaseLogger, type FastifyInstance } from 'fastify';

import { errorResponse } from '../application/contracts/error-response.js';
import type { SendOutboundMessage } from '../application/use-cases/send-outbound-message.js';
import { type ConfigRoutesDeps, registerConfigRoutes } from './routes/config.js';
import { type ConversationRoutesDeps, registerConversationRoutes } from './routes/conversations.js';
import { type EventRoutesDeps, registerEventRoutes } from './routes/events.js';
import { type HealthRoutesDeps, registerHealthRoutes } from './routes/health.js';
import { registerMessageRoutes } from './routes/messages.js';
import { type SimulateRoutesDeps, registerSimulateRoutes } from './routes/simulate.js';
import { type WebhookRoutesDeps, registerWebhookRoutes } from './routes/webhook.js';

export type ServerDeps = ConversationRoutesDeps &
  WebhookRoutesDeps &
  EventRoutesDeps &
  HealthRoutesDeps &
  ConfigRoutesDeps & {
    sendOutboundMessage?: SendOutboundMessage;
    simulate?: SimulateRoutesDeps | null;
    loggerInstance?: FastifyBaseLogger;
    trustProxy?: boolean;
    adminDir?: string;
  };

const apiPrefixes = ['/api', '/dev', '/health', '/webhooks'] as const;

// Static files serve directly; any other non-API GET falls back to index.html for client-side routes.
function registerAdminSpa(app: FastifyInstance, adminDir: string): void {
  app.register(fastifyStatic, { root: adminDir, wildcard: false });
  app.setNotFoundHandler((request, reply) => {
    const path = request.url.split('?', 1)[0] ?? request.url;
    const isApiPath = apiPrefixes.some((prefix) => path === prefix || path.startsWith(`${prefix}/`));
    if (request.method === 'GET' && !isApiPath) {
      return reply.type('text/html').sendFile('index.html');
    }
    return reply.code(404).send(errorResponse('not found'));
  });
}

export function buildServer(deps: ServerDeps): FastifyInstance {
  // Without forceClose, app.close() would block forever on the hijacked, long-lived SSE connections.
  const app = Fastify({
    forceCloseConnections: true,
    trustProxy: deps.trustProxy ?? false,
    ...(deps.loggerInstance ? { loggerInstance: deps.loggerInstance } : {}),
  });
  // Twilio posts application/x-www-form-urlencoded, which Fastify does not parse natively.
  app.register(formbody);
  registerConversationRoutes(app, deps);
  registerWebhookRoutes(app, deps);
  registerEventRoutes(app, deps);
  registerHealthRoutes(app, deps);
  registerConfigRoutes(app, deps);
  if (deps.sendOutboundMessage) {
    registerMessageRoutes(app, { sendOutboundMessage: deps.sendOutboundMessage });
  }
  if (deps.simulate) registerSimulateRoutes(app, deps.simulate);
  if (deps.adminDir) registerAdminSpa(app, deps.adminDir);
  return app;
}
