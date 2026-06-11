import type { Tx } from './tx.js';

// Both methods issue a Postgres NOTIFY inside their transaction; it is delivered on
// commit. jobCreated rides tx1 (worker wake-up); conversationChanged rides tx2 (SSE fan-out).
export interface Notifier {
  jobCreated(tx: Tx, jobId: string): Promise<void>;
  conversationChanged(tx: Tx, conversationId: string): Promise<void>;
}
