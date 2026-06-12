import { type ConversationChangedSseEvent, conversationChangedSseEventSchema } from './schemas';

export type SseStatus = 'connecting' | 'open' | 'closed';

export interface SseHandlers {
  onEvent: (event: ConversationChangedSseEvent) => void;
  onStatus: (status: SseStatus) => void;
}

export function connectEvents(url: string, handlers: SseHandlers): () => void {
  const source = new EventSource(url);
  handlers.onStatus('connecting');

  source.onopen = () => handlers.onStatus('open');
  source.onmessage = (event: MessageEvent<string>) => {
    let payload: unknown;
    try {
      payload = JSON.parse(event.data);
    } catch {
      return;
    }
    const parsed = conversationChangedSseEventSchema.safeParse(payload);
    if (parsed.success) handlers.onEvent(parsed.data);
  };
  source.onerror = () => {
    handlers.onStatus(source.readyState === EventSource.CLOSED ? 'closed' : 'connecting');
  };

  return () => {
    source.close();
    handlers.onStatus('closed');
  };
}
