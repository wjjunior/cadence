import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { FakeEventSource } from '@/test/fake-event-source';

import { useLiveUpdates } from './use-live-updates';

beforeEach(() => {
  FakeEventSource.reset();
  vi.stubGlobal('EventSource', FakeEventSource);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('useLiveUpdates', () => {
  it('should invalidate the changed conversation and the list on an event', () => {
    const queryClient = new QueryClient();
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );

    const cid = 'c0000000-0000-4000-8000-000000000009';
    renderHook(() => useLiveUpdates(), { wrapper });
    act(() => {
      FakeEventSource.last().emitMessage(
        JSON.stringify({ type: 'conversation.changed', conversationId: cid }),
      );
    });

    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['conversation', cid, 'messages'] });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['conversations'] });
  });

  it('should report the live connection status', () => {
    const queryClient = new QueryClient();
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );

    const { result } = renderHook(() => useLiveUpdates(), { wrapper });
    act(() => FakeEventSource.last().emitOpen());

    expect(result.current).toBe('open');
  });
});
