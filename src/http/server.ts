import formbody from '@fastify/formbody';
import Fastify, { type FastifyBaseLogger, type FastifyInstance } from 'fastify';

import { type ConversationRoutesDeps, registerConversationRoutes } from './routes/conversations.js';
import { type EventRoutesDeps, registerEventRoutes } from './routes/events.js';
import { type HealthRoutesDeps, registerHealthRoutes } from './routes/health.js';
import { type SimulateRoutesDeps, registerSimulateRoutes } from './routes/simulate.js';
import { type WebhookRoutesDeps, registerWebhookRoutes } from './routes/webhook.js';

export type ServerDeps = ConversationRoutesDeps &
  WebhookRoutesDeps &
  EventRoutesDeps &
  HealthRoutesDeps & {
    // Present only in mock mode; the simulate route is otherwise absent (not just disabled).
    simulate?: SimulateRoutesDeps | null;
    loggerInstance?: FastifyBaseLogger;
  };

export function buildServer(deps: ServerDeps): FastifyInstance {
  // SSE connections are long-lived and hijacked; without forceClose, app.close() would block on
  // them forever (and their heartbeat intervals keep the event loop alive). Forcing them closed
  // fires each connection's `close`, running the route teardown.
  const app = Fastify({
    forceCloseConnections: true,
    ...(deps.loggerInstance ? { loggerInstance: deps.loggerInstance } : {}),
  });
  // Twilio posts application/x-www-form-urlencoded, which Fastify does not parse natively.
  app.register(formbody);
  registerConversationRoutes(app, deps);
  registerWebhookRoutes(app, deps);
  registerEventRoutes(app, deps);
  registerHealthRoutes(app, deps);
  if (deps.simulate) registerSimulateRoutes(app, deps.simulate);
  return app;
}
