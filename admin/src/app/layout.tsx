import { Outlet } from 'react-router-dom';

import { useLiveUpdates } from '@/features/live-updates';
import { ConversationsPage } from '@/pages/conversations';
import { ConnectionStatus } from '@/widgets/connection-status';

export function AppLayout() {
  const status = useLiveUpdates();

  return (
    <div className="flex h-screen flex-col">
      <header className="flex items-center justify-between border-b px-4 py-3">
        <span className="text-lg font-semibold tracking-tight">Cadence</span>
        <ConnectionStatus status={status} />
      </header>
      <div className="grid flex-1 grid-cols-[minmax(280px,360px)_1fr] overflow-hidden">
        <aside className="overflow-hidden border-r">
          <ConversationsPage />
        </aside>
        <main className="overflow-hidden">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
