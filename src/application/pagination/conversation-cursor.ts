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

export function encodeConversationCursor(cursor: ConversationCursor): string {
  return Buffer.from(JSON.stringify(cursor)).toString('base64url');
}

function isConversationCursor(value: unknown): value is ConversationCursor {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as ConversationCursor).lastMessageAt === 'string' &&
    typeof (value as ConversationCursor).id === 'string'
  );
}

export function decodeConversationCursor(token: string): ConversationCursor {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(token, 'base64url').toString());
  } catch {
    throw new InvalidCursorError(token);
  }
  if (!isConversationCursor(parsed)) {
    throw new InvalidCursorError(token);
  }
  return { lastMessageAt: parsed.lastMessageAt, id: parsed.id };
}
