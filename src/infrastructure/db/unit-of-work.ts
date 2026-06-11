import type { Tx, UnitOfWork } from '../../application/ports/tx.js';
import type { Database } from './client.js';
import { asTx } from './tx.js';

export class DrizzleUnitOfWork implements UnitOfWork {
  constructor(private readonly db: Database) {}

  run<T>(work: (tx: Tx) => Promise<T>): Promise<T> {
    return this.db.transaction((drizzleTx) => work(asTx(drizzleTx)));
  }
}
