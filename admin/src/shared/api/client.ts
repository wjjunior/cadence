import type { z } from 'zod';

import { CONVERSATION_PAGE_SIZE } from '@/shared/config';

import {
  type AppConfig,
  type ConversationDetail,
  type ConversationListPage,
  appConfigSchema,
  conversationDetailSchema,
  conversationListPageSchema,
} from './schemas';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function getJson<T>(url: string, schema: z.ZodType<T>): Promise<T> {
  const res = await fetch(url, { headers: { accept: 'application/json' } });
  if (!res.ok) throw new ApiError(res.status, `GET ${url} failed (${res.status})`);
  return schema.parse(await res.json());
}

export function fetchConfig(): Promise<AppConfig> {
  return getJson('/api/config', appConfigSchema);
}

export function fetchConversations(cursor: string | null): Promise<ConversationListPage> {
  const params = new URLSearchParams({ limit: String(CONVERSATION_PAGE_SIZE) });
  if (cursor) params.set('cursor', cursor);
  return getJson(`/api/conversations?${params.toString()}`, conversationListPageSchema);
}

export function fetchConversationDetail(id: string): Promise<ConversationDetail> {
  return getJson(`/api/conversations/${id}/messages`, conversationDetailSchema);
}

export async function simulateInbound(input: { from: string; body: string }): Promise<void> {
  const res = await fetch('/dev/simulate-inbound', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new ApiError(res.status, `simulate failed (${res.status})`);
}
