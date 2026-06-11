import type { FastifyInstance } from 'fastify';

import type { EventBus } from '../../application/ports/event-bus.js';
import { toSseEvent } from '../schemas/events.js';
import { SseStream } from '../sse-stream.js';

export interface EventRoutesDeps {
  eventBus: EventBus;
  heartbeatMs: number;
}

const SSE_HEADERS = {
  'content-type': 'text/event-stream',
  'cache-control': 'no-cache',
  connection: 'keep-alive',
  // Defeat proxy/nginx response buffering so events flush immediately.
  'x-accel-buffering': 'no',
};

export function registerEventRoutes(app: FastifyInstance, deps: EventRoutesDeps): void {
  app.get('/api/events', (request, reply) => {
    reply.hijack();
    const raw = reply.raw;
    raw.writeHead(200, SSE_HEADERS);
    raw.write(':ok\n\n');

    let stopped = false;
    let unsubscribe: () => void = () => {};
    let heartbeat: ReturnType<typeof setInterval> | null = null;
    const stop = (): void => {
      if (stopped) return;
      stopped = true;
      if (heartbeat) clearInterval(heartbeat);
      unsubscribe();
    };

    const stream = new SseStream(raw, { onClose: stop });
    unsubscribe = deps.eventBus.subscribe((event) =>
      stream.event(JSON.stringify(toSseEvent(event))),
    );
    heartbeat = setInterval(() => stream.comment(), deps.heartbeatMs);
    request.raw.on('close', () => {
      stop();
      stream.close();
    });
  });
}
