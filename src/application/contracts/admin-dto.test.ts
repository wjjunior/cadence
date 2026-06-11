import { describe, expect, it } from 'vitest';
import {
  ConversationDetail,
  ConversationListPage,
  ConversationSummary,
  MessageDto,
} from './admin-dto.js';

const message = {
  id: 'm1',
  direction: 'inbound',
  body: 'hi',
  status: 'received',
  errorDetail: null,
  createdAt: '2026-06-11T00:00:00.000Z',
};

const summary = {
  id: 'c1',
  userPhone: '+15550001234',
  systemPhone: '+15559876543',
  lastMessageAt: '2026-06-11T00:00:00.000Z',
  createdAt: '2026-06-11T00:00:00.000Z',
};

describe('MessageDto', () => {
  it('should parse a representative message DTO', () => {
    expect(MessageDto.parse(message)).toEqual(message);
  });

  it('should reject a status outside the message vocabulary', () => {
    expect(() => MessageDto.parse({ ...message, status: 'bogus' })).toThrow();
  });

  it('should reject a non-ISO createdAt', () => {
    expect(() => MessageDto.parse({ ...message, createdAt: 'not-a-date' })).toThrow();
  });
});

describe('ConversationSummary', () => {
  it('should parse a representative summary', () => {
    expect(ConversationSummary.parse(summary)).toEqual(summary);
  });

  it('should reject a null lastMessageAt (always set since the first message)', () => {
    expect(() => ConversationSummary.parse({ ...summary, lastMessageAt: null })).toThrow();
  });
});

describe('ConversationDetail', () => {
  it('should parse a header with its messages', () => {
    const detail = { ...summary, messages: [message] };
    expect(ConversationDetail.parse(detail)).toEqual(detail);
  });
});

describe('ConversationListPage', () => {
  it('should parse a page with a null cursor', () => {
    const page = { items: [summary], nextCursor: null };
    expect(ConversationListPage.parse(page)).toEqual(page);
  });
});
