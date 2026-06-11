import { useMutation, useQueryClient } from '@tanstack/react-query';

import { queryKeys, simulateInbound } from '@/shared/api';

export function useSimulateInbound() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: simulateInbound,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.conversationList });
    },
  });
}
