import { z } from 'zod';

export interface ConversationCursor {
  lastMessageAt: string;
  id: string;
}

export class InvalidCursorError extends Error {
  constructor(token: string) {
    super(`Invalid pagination cursor: ${JSON.stringify(token)}`);
    this.name = 'InvalidCursorError';
  }
}

// Format-validated so a tampered cursor is rejected here, not by a ::timestamptz/::uuid
// cast error deep in the repository query.
const cursorSchema = z.object({ lastMessageAt: z.iso.datetime(), id: z.uuid() });

export function encodeConversationCursor(cursor: ConversationCursor): string {
  return Buffer.from(JSON.stringify(cursor)).toString('base64url');
}

export function decodeConversationCursor(token: string): ConversationCursor {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(token, 'base64url').toString());
  } catch {
    throw new InvalidCursorError(token);
  }
  const result = cursorSchema.safeParse(parsed);
  if (!result.success) {
    throw new InvalidCursorError(token);
  }
  return result.data;
}
