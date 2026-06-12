import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { errorResponse } from '../../application/contracts/error-response.js';
import { InvalidCursorError } from '../../application/pagination/conversation-cursor.js';
import type { GetConversationDetail } from '../../application/use-cases/get-conversation-detail.js';
import type { ListConversations } from '../../application/use-cases/list-conversations.js';

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

const listQuery = z.object({
  cursor: z
    .string()
    .optional()
    .transform((v) => (v === '' ? undefined : v)),
  limit: z.coerce.number().int().min(1).max(MAX_LIMIT).default(DEFAULT_LIMIT),
});

const detailParams = z.object({ id: z.uuid() });

export interface ConversationRoutesDeps {
  listConversations: ListConversations;
  getConversationDetail: GetConversationDetail;
}

export function registerConversationRoutes(
  app: FastifyInstance,
  deps: ConversationRoutesDeps,
): void {
  app.get('/api/conversations', async (request, reply) => {
    const query = listQuery.safeParse(request.query);
    if (!query.success) return reply.code(400).send(errorResponse('invalid query'));
    try {
      return await deps.listConversations.execute({
        cursor: query.data.cursor ?? null,
        limit: query.data.limit,
      });
    } catch (error) {
      if (error instanceof InvalidCursorError) {
        return reply.code(400).send(errorResponse('invalid cursor'));
      }
      throw error;
    }
  });

  app.get('/api/conversations/:id/messages', async (request, reply) => {
    const params = detailParams.safeParse(request.params);
    if (!params.success) return reply.code(400).send(errorResponse('invalid conversation id'));
    const detail = await deps.getConversationDetail.execute(params.data.id);
    if (!detail) return reply.code(404).send(errorResponse('conversation not found'));
    return detail;
  });
}
