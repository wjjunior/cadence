import type { Tx } from '../../application/ports/tx.js';
import type { Database } from './client.js';

export type DrizzleTx = Parameters<Parameters<Database['transaction']>[0]>[0];

// The single boundary cast between the opaque application Tx and the concrete Drizzle transaction.
export const asTx = (tx: DrizzleTx): Tx => tx as unknown as Tx;
export const asDrizzle = (tx: Tx): DrizzleTx => tx as unknown as DrizzleTx;
