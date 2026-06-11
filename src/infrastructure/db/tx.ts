import type { Tx } from '../../application/ports/tx.js';
import type { Database } from './client.js';

// The exact transaction handle Drizzle passes to a db.transaction(cb) callback.
export type DrizzleTx = Parameters<Parameters<Database['transaction']>[0]>[0];

// The one sanctioned place a real Drizzle transaction is branded as the opaque
// Tx and unbranded again (ports/tx.ts). Shared with CAD-15; never redefined.
export function asTx(tx: DrizzleTx): Tx {
  return tx as unknown as Tx;
}

export function asDrizzle(tx: Tx): DrizzleTx {
  return tx as unknown as DrizzleTx;
}
