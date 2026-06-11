import Fastify, { type FastifyInstance } from 'fastify';

import { type ConversationRoutesDeps, registerConversationRoutes } from './routes/conversations.js';

export function buildServer(deps: ConversationRoutesDeps): FastifyInstance {
  const app = Fastify();
  registerConversationRoutes(app, deps);
  return app;
}
