import type { Tx } from './tx.js';

// NOTIFY is issued inside the transaction and delivered on commit, hence the tx parameter.
// jobCreated carries no payload: it is an advisory wake signal and the worker claims via the
// claim query, not the notification.
export interface Notifier {
  jobCreated(tx: Tx): Promise<void>;
  conversationChanged(tx: Tx, conversationId: string): Promise<void>;
}
