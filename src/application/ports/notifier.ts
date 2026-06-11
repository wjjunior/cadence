import type { Tx } from './tx.js';

// NOTIFY is issued inside the transaction and delivered on commit, hence the tx parameter.
export interface Notifier {
  jobCreated(tx: Tx, jobId: string): Promise<void>;
  conversationChanged(tx: Tx, conversationId: string): Promise<void>;
}
