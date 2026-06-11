import { describe, expect, it } from 'vitest';

import type { Conversation } from '../../domain/conversation.js';
import { decodeConversationCursor } from '../pagination/conversation-cursor.js';
import type { ConversationRepository } from '../ports/conversation-repository.js';
import { ListConversations } from './list-conversations.js';

const iso = '2026-06-11T10:00:00.000Z';

const conv = (id: string): Conversation => ({
  id,
  userPhone: '+15550001111',
  systemPhone: '+15550002222',
  lastMessageAt: new Date(iso),
  createdAt: new Date(iso),
});

function repoOf(rows: Conversation[]): ConversationRepository {
  return {
    list: ({ limit }) => Promise.resolve(rows.slice(0, limit)),
    getById: () => Promise.reject(new Error('unused')),
    upsert: () => Promise.reject(new Error('unused')),
    touch: () => Promise.reject(new Error('unused')),
  };
}

const uuid = (n: number): string => `${String(n).padStart(8, '0')}-1111-4111-8111-111111111111`;

describe('ListConversations', () => {
  it('should set nextCursor and trim to limit when the repo returns limit+1 rows', async () => {
    const rows = Array.from({ length: 25 }, (_, i) => conv(uuid(i)));
    const page = await new ListConversations(repoOf(rows)).execute({ cursor: null, limit: 20 });

    expect(page.items).toHaveLength(20);
    expect(page.nextCursor).not.toBeNull();
    expect(decodeConversationCursor(page.nextCursor!).id).toBe(page.items[19]!.id);
  });

  it('should set nextCursor null when fewer than limit+1 rows are returned', async () => {
    const page = await new ListConversations(repoOf([conv(uuid(1))])).execute({
      cursor: null,
      limit: 20,
    });

    expect(page.items).toHaveLength(1);
    expect(page.nextCursor).toBeNull();
  });

  it('should map rows to ConversationSummary with ISO timestamps', async () => {
    const page = await new ListConversations(repoOf([conv(uuid(1))])).execute({
      cursor: null,
      limit: 20,
    });

    expect(page.items[0]).toMatchObject({ id: uuid(1), lastMessageAt: iso, createdAt: iso });
  });
});
