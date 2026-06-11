import type { ConversationSummary } from '@/shared/api';
import { cn, formatPhone, relativeTime } from '@/shared/lib';
import { Card } from '@/shared/ui';

export function ConversationSummaryCard({
  conversation,
  active,
  onSelect,
}: {
  conversation: ConversationSummary;
  active: boolean;
  onSelect: (id: string) => void;
}) {
  return (
    <button type="button" onClick={() => onSelect(conversation.id)} className="block w-full text-left">
      <Card
        className={cn(
          'p-3 transition-colors hover:border-primary/40',
          active && 'border-primary ring-1 ring-primary',
        )}
      >
        <div className="flex items-center justify-between gap-2">
          <span className="truncate font-medium">{formatPhone(conversation.userPhone)}</span>
          <time
            dateTime={conversation.lastMessageAt}
            className="shrink-0 text-xs text-muted-foreground"
          >
            {relativeTime(conversation.lastMessageAt)}
          </time>
        </div>
        <div className="mt-0.5 truncate text-xs text-muted-foreground">
          to {formatPhone(conversation.systemPhone)}
        </div>
      </Card>
    </button>
  );
}
