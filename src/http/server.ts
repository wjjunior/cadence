import formbody from '@fastify/formbody';
import fastifyStatic from '@fastify/static';
import Fastify, { type FastifyBaseLogger, type FastifyInstance } from 'fastify';

import { errorResponse } from '../application/contracts/error-response.js';
import { type ConfigRoutesDeps, registerConfigRoutes } from './routes/config.js';
import { type ConversationRoutesDeps, registerConversationRoutes } from './routes/conversations.js';
import { type EventRoutesDeps, registerEventRoutes } from './routes/events.js';
import { type HealthRoutesDeps, registerHealthRoutes } from './routes/health.js';
import { type SimulateRoutesDeps, registerSimulateRoutes } from './routes/simulate.js';
import { type WebhookRoutesDeps, registerWebhookRoutes } from './routes/webhook.js';

export type ServerDeps = ConversationRoutesDeps &
  WebhookRoutesDeps &
  EventRoutesDeps &
  HealthRoutesDeps &
  ConfigRoutesDeps & {
    // Present only in mock mode; the simulate route is otherwise absent (not just disabled).
    simulate?: SimulateRoutesDeps | null;
    loggerInstance?: FastifyBaseLogger;
    // Trust X-Forwarded-* so the Twilio signature URL reflects the external scheme/host
    // (only behind a known proxy; off by default).
    trustProxy?: boolean;
    // Absolute path to the built admin SPA; when set, the API also serves it (one-command stack).
    adminDir?: string;
  };

const apiPrefixes = ['/api', '/dev', '/health', '/webhooks'] as const;

// Serve the built SPA: real files (index.html, /assets/*) are served by @fastify/static; any other
// GET that isn't an API path falls back to index.html so client-side routes (/c/:id) and refreshes
// resolve. Unknown API paths stay a JSON 404, never the SPA HTML.
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
  // SSE connections are long-lived and hijacked; without forceClose, app.close() would block on
  // them forever (and their heartbeat intervals keep the event loop alive). Forcing them closed
  // fires each connection's `close`, running the route teardown.
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
  if (deps.simulate) registerSimulateRoutes(app, deps.simulate);
  if (deps.adminDir) registerAdminSpa(app, deps.adminDir);
  return app;
}
