import { sql } from 'drizzle-orm';
import type { Notifier } from '../../application/ports/notifier.js';
import type { Tx } from '../../application/ports/tx.js';
import { asDrizzle } from '../db/tx.js';

const channel = {
  jobCreated: 'job_created',
  conversationChanged: 'conversation_changed',
} as const;

export class PgNotifier implements Notifier {
  async jobCreated(tx: Tx, jobId: string): Promise<void> {
    await asDrizzle(tx).execute(sql`select pg_notify(${channel.jobCreated}, ${jobId})`);
  }

  async conversationChanged(tx: Tx, conversationId: string): Promise<void> {
    await asDrizzle(tx).execute(
      sql`select pg_notify(${channel.conversationChanged}, ${conversationId})`,
    );
  }
}
