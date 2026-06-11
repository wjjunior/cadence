import { useNavigate, useParams } from 'react-router-dom';

import { ConversationList } from '@/widgets/conversation-list';
import { SimulatePanel } from '@/widgets/simulate-panel';

export function ConversationsPage() {
  const navigate = useNavigate();
  const { id } = useParams();

  return (
    <div className="flex h-full flex-col gap-4 overflow-y-auto p-4">
      <SimulatePanel />
      <ConversationList selectedId={id ?? null} onSelect={(cid) => navigate(`/c/${cid}`)} />
    </div>
  );
}
