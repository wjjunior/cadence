import type { FastifyInstance } from 'fastify';

import type { HealthResponse } from '../../application/contracts/health.js';
import type { HealthRepository } from '../../application/ports/health-repository.js';

export interface HealthRoutesDeps {
  healthRepository: HealthRepository;
}

export function registerHealthRoutes(app: FastifyInstance, deps: HealthRoutesDeps): void {
  app.get('/health', async (_request, reply) => {
    try {
      const snapshot = await deps.healthRepository.snapshot();
      const body: HealthResponse = {
        db: 'ok',
        worker: { heartbeatAgeMs: snapshot.heartbeatAgeMs },
        queue: { pending: snapshot.pending, oldestPendingAgeMs: snapshot.oldestPendingAgeMs },
      };
      return body;
    } catch {
      return reply.code(503).send({ db: 'down' });
    }
  });
}
