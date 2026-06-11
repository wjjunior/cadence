import { MessageSquare } from 'lucide-react';
import { useParams } from 'react-router-dom';

import { ConversationThread } from '@/widgets/conversation-thread';

function EmptyState() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 p-8 text-center text-muted-foreground">
      <MessageSquare className="size-8 opacity-40" />
      <p className="text-sm">Select a conversation to see its messages.</p>
    </div>
  );
}

export function ConversationDetailPage() {
  const { id } = useParams();
  if (!id) return <EmptyState />;
  return <ConversationThread conversationId={id} />;
}
