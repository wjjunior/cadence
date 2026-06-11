import formbody from '@fastify/formbody';
import Fastify, { type FastifyInstance } from 'fastify';

import { type ConversationRoutesDeps, registerConversationRoutes } from './routes/conversations.js';
import { type WebhookRoutesDeps, registerWebhookRoutes } from './routes/webhook.js';

export type ServerDeps = ConversationRoutesDeps & WebhookRoutesDeps;

export function buildServer(deps: ServerDeps): FastifyInstance {
  const app = Fastify();
  // Twilio posts application/x-www-form-urlencoded, which Fastify does not parse natively.
  app.register(formbody);
  registerConversationRoutes(app, deps);
  registerWebhookRoutes(app, deps);
  return app;
}
