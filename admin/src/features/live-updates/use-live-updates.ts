import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';

import { type SseStatus, connectEvents, queryKeys } from '@/shared/api';
import { EVENTS_URL } from '@/shared/config';

// One app-wide SSE subscription: a conversation.changed event invalidates that
// conversation's detail and the list. Returns the connection status for the
// reconnecting indicator. The 30s fallback refetch lives on the queries.
export function useLiveUpdates(): SseStatus {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<SseStatus>('connecting');

  useEffect(() => {
    return connectEvents(EVENTS_URL, {
      onStatus: setStatus,
      onEvent: (event) => {
        void queryClient.invalidateQueries({
          queryKey: queryKeys.conversationDetail(event.conversationId),
        });
        void queryClient.invalidateQueries({ queryKey: queryKeys.conversationList });
      },
    });
  }, [queryClient]);

  return status;
}
