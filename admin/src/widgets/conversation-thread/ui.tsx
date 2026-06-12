import { useQuery } from '@tanstack/react-query';

import { MessageBubble } from '@/entities/message';
import { fetchConversationDetail, queryKeys } from '@/shared/api';
import { FALLBACK_REFETCH_MS } from '@/shared/config';
import { formatPhone } from '@/shared/lib';
import { ScrollArea, Separator, Skeleton } from '@/shared/ui';

const threadSkeletonKeys = ['a', 'b', 'c', 'd'] as const;

export function ConversationThread({ conversationId }: Readonly<{ conversationId: string }>) {
  const query = useQuery({
    queryKey: queryKeys.conversationDetail(conversationId),
    queryFn: () => fetchConversationDetail(conversationId),
    refetchInterval: FALLBACK_REFETCH_MS,
  });

  if (query.isPending) {
    return (
      <div className="flex flex-col gap-3 p-4">
        {threadSkeletonKeys.map((key) => (
          <Skeleton key={key} className="h-12 w-2/3" />
        ))}
      </div>
    );
  }
  if (query.isError) {
    return <p className="p-4 text-sm text-destructive">Failed to load this conversation.</p>;
  }

  const { messages, userPhone, systemPhone } = query.data;
  return (
    <div className="flex h-full flex-col">
      <header className="px-4 py-3">
        <h2 className="font-semibold">{formatPhone(userPhone)}</h2>
        <p className="text-xs text-muted-foreground">to {formatPhone(systemPhone)}</p>
      </header>
      <Separator />
      <ScrollArea className="flex-1">
        <div className="flex flex-col gap-4 p-4">
          {messages.length === 0 ? (
            <p className="text-sm text-muted-foreground">No messages yet.</p>
          ) : (
            messages.map((message) => <MessageBubble key={message.id} message={message} />)
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
