import { useInfiniteQuery } from '@tanstack/react-query';

import { ConversationSummaryCard } from '@/entities/conversation';
import { fetchConversations, queryKeys } from '@/shared/api';
import { FALLBACK_REFETCH_MS } from '@/shared/config';
import { Button, Skeleton } from '@/shared/ui';

function ListSkeleton() {
  return (
    <div className="flex flex-col gap-2">
      {Array.from({ length: 6 }).map((_, i) => (
        <Skeleton key={i} className="h-16 w-full" />
      ))}
    </div>
  );
}

export function ConversationList({
  selectedId,
  onSelect,
}: {
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const query = useInfiniteQuery({
    queryKey: queryKeys.conversationList,
    queryFn: ({ pageParam }) => fetchConversations(pageParam),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
    refetchInterval: FALLBACK_REFETCH_MS,
  });

  if (query.isPending) return <ListSkeleton />;
  if (query.isError) {
    return <p className="p-3 text-sm text-destructive">Failed to load conversations.</p>;
  }

  const items = query.data.pages.flatMap((page) => page.items);
  if (items.length === 0) {
    return <p className="p-3 text-sm text-muted-foreground">No conversations yet.</p>;
  }

  return (
    <div className="flex flex-col gap-2">
      {items.map((conversation) => (
        <ConversationSummaryCard
          key={conversation.id}
          conversation={conversation}
          active={conversation.id === selectedId}
          onSelect={onSelect}
        />
      ))}
      {query.hasNextPage && (
        <Button
          variant="outline"
          size="sm"
          onClick={() => void query.fetchNextPage()}
          disabled={query.isFetchingNextPage}
        >
          {query.isFetchingNextPage ? 'Loading…' : 'Load more'}
        </Button>
      )}
    </div>
  );
}
