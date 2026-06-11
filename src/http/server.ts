import Fastify, { type FastifyInstance } from 'fastify';

import { type ConversationRoutesDeps, registerConversationRoutes } from './routes/conversations.js';
import { type EventRoutesDeps, registerEventRoutes } from './routes/events.js';

export type ServerDeps = ConversationRoutesDeps & EventRoutesDeps;

export function buildServer(deps: ServerDeps): FastifyInstance {
  // SSE connections are long-lived and hijacked; without forceClose, app.close() would block on
  // them forever (and their heartbeat intervals keep the event loop alive). Forcing them closed
  // fires each connection's `close`, running the route teardown.
  const app = Fastify({ forceCloseConnections: true });
  registerConversationRoutes(app, deps);
  registerEventRoutes(app, deps);
  return app;
}
