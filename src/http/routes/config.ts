import type { FastifyInstance } from 'fastify';

import type { AppConfig } from '../../application/contracts/app-config.js';

export interface ConfigRoutesDeps {
  smsProvider: AppConfig['smsProvider'];
}

export function registerConfigRoutes(app: FastifyInstance, deps: ConfigRoutesDeps): void {
  app.get('/api/config', async (): Promise<AppConfig> => {
    return { smsProvider: deps.smsProvider };
  });
}
