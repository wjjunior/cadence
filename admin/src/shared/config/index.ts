// Graceful-degradation refetch when the SSE stream drops: notify for latency, poll for guarantee.
export const FALLBACK_REFETCH_MS = 30_000;
export const CONVERSATION_PAGE_SIZE = 20;
export const EVENTS_URL = '/api/events';
