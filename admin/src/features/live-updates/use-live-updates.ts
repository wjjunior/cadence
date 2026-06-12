import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';

import { type SseStatus, connectEvents, queryKeys } from '@/shared/api';
import { EVENTS_URL } from '@/shared/config';

// One app-wide SSE subscription invalidating the changed conversation's detail and the list.
export function useLiveUpdates(): SseStatus {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<SseStatus>('connecting');

  useEffect(() => {
    return connectEvents(EVENTS_URL, {
      onStatus: setStatus,
      onEvent: (event) => {
        queryClient.invalidateQueries({
          queryKey: queryKeys.conversationDetail(event.conversationId),
        });
        queryClient.invalidateQueries({ queryKey: queryKeys.conversationList });
      },
    });
  }, [queryClient]);

  return status;
}
