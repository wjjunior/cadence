import { describe, expect, it } from 'vitest';
import {
  InvalidCursorError,
  decodeConversationCursor,
  encodeConversationCursor,
} from './conversation-cursor.js';

const cursor = {
  lastMessageAt: '2026-06-11T00:00:00.000Z',
  id: '550e8400-e29b-41d4-a716-446655440000',
};

describe('conversation cursor codec', () => {
  it('should round-trip encode then decode to the same cursor', () => {
    expect(decodeConversationCursor(encodeConversationCursor(cursor))).toEqual(cursor);
  });

  it('should produce a url-safe token', () => {
    expect(encodeConversationCursor(cursor)).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('should reject a malformed token', () => {
    expect(() => decodeConversationCursor('@@@not-valid@@@')).toThrow(InvalidCursorError);
  });

  it('should reject a token missing required fields', () => {
    const bad = Buffer.from(JSON.stringify({ id: 'x' })).toString('base64url');
    expect(() => decodeConversationCursor(bad)).toThrow(InvalidCursorError);
  });
});
