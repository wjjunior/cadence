import { screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { jsonResponse, renderWithClient } from '@/test/render';

import { ConversationList } from './ui';

const page = {
  items: [
    {
      id: 'c1',
      userPhone: '+15550001234',
      systemPhone: '+15559876543',
      lastMessageAt: '2026-06-11T12:00:00.000Z',
      createdAt: '2026-06-11T11:00:00.000Z',
    },
  ],
  nextCursor: null,
};

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(() => Promise.resolve(jsonResponse(page))),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('ConversationList', () => {
  it('should render a card for each conversation', async () => {
    renderWithClient(<ConversationList selectedId={null} onSelect={() => {}} />);

    expect(await screen.findByText('+1 555 000 1234')).toBeInTheDocument();
  });
});
