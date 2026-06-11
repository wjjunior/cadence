import type { Tx } from './tx.js';

export interface WebhookEventRepository {
  // inserted=false signals a duplicate delivery (ON CONFLICT (provider_sid) DO NOTHING).
  insertIgnoringDuplicate(
    tx: Tx,
    providerSid: string,
    payload: unknown,
  ): Promise<{ inserted: boolean }>;
}
