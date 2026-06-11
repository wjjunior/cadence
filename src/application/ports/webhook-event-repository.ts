import type { Tx } from './tx.js';

export interface WebhookEventRepository {
  // Edge-of-system dedup ledger: ON CONFLICT (provider_sid) DO NOTHING. `inserted`
  // is false when the webhook was already seen (the duplicate-delivery signal). tx1.
  insertIgnoringDuplicate(
    tx: Tx,
    providerSid: string,
    payload: unknown,
  ): Promise<{ inserted: boolean }>;
}
