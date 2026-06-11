import Fastify, { type FastifyInstance } from 'fastify';

import { type ConversationRoutesDeps, registerConversationRoutes } from './routes/conversations.js';
import { type EventRoutesDeps, registerEventRoutes } from './routes/events.js';

export type ServerDeps = ConversationRoutesDeps & EventRoutesDeps;

export function buildServer(deps: ServerDeps): FastifyInstance {
  const app = Fastify();
  registerConversationRoutes(app, deps);
  registerEventRoutes(app, deps);
  return app;
}
