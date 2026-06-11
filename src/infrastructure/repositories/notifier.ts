import { sql } from 'drizzle-orm';
import type { Notifier } from '../../application/ports/notifier.js';
import type { Tx } from '../../application/ports/tx.js';
import { notifyChannels } from '../db/notify-channels.js';
import { asDrizzle } from '../db/tx.js';

export class PgNotifier implements Notifier {
  async jobCreated(tx: Tx): Promise<void> {
    await asDrizzle(tx).execute(sql`select pg_notify(${notifyChannels.jobCreated}, '')`);
  }

  async conversationChanged(tx: Tx, conversationId: string): Promise<void> {
    await asDrizzle(tx).execute(
      sql`select pg_notify(${notifyChannels.conversationChanged}, ${conversationId})`,
    );
  }
}
