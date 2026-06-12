import type { MessageDto, MessageStatus } from '@/shared/api';
import { cn, formatTime } from '@/shared/lib';
import { Badge, Tooltip, TooltipContent, TooltipTrigger } from '@/shared/ui';

import { statusBadge } from './status-badge';

export function StatusBadge({
  status,
  errorDetail,
}: Readonly<{
  status: MessageStatus;
  errorDetail: string | null;
}>) {
  const spec = statusBadge(status);
  const badge = (
    <Badge variant={spec.variant} className={spec.pulse ? 'animate-pulse' : undefined}>
      {spec.label}
    </Badge>
  );

  if (status === 'failed' && errorDetail) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="inline-flex cursor-help">{badge}</span>
        </TooltipTrigger>
        <TooltipContent>{errorDetail}</TooltipContent>
      </Tooltip>
    );
  }
  return badge;
}

export function DirectionTag({ direction }: Readonly<{ direction: MessageDto['direction'] }>) {
  return (
    <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
      {direction === 'inbound' ? 'User' : 'System'}
    </span>
  );
}

export function MessageBubble({ message }: Readonly<{ message: MessageDto }>) {
  const isInbound = message.direction === 'inbound';
  return (
    <div className={cn('flex flex-col gap-1', isInbound ? 'items-start' : 'items-end')}>
      <div className="flex items-center gap-2">
        <DirectionTag direction={message.direction} />
        <StatusBadge status={message.status} errorDetail={message.errorDetail} />
      </div>
      <div
        className={cn(
          'max-w-[80%] whitespace-pre-wrap rounded-lg px-3 py-2 text-sm',
          isInbound ? 'bg-muted text-foreground' : 'bg-primary text-primary-foreground',
        )}
      >
        {message.body || <span className="italic opacity-70">(empty)</span>}
      </div>
      <time dateTime={message.createdAt} className="text-[11px] text-muted-foreground">
        {formatTime(message.createdAt)}
      </time>
    </div>
  );
}
