import { sql } from 'drizzle-orm';
import {
  type AnyPgColumn,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import type { JobStatus } from '../../domain/job.js';
import type { MessageDirection, MessageStatus } from '../../domain/status.js';

const id = () =>
  uuid()
    .primaryKey()
    .default(sql`gen_random_uuid()`);

const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();

export const conversations = pgTable(
  'conversations',
  {
    id: id(),
    userPhone: text('user_phone').notNull(),
    systemPhone: text('system_phone').notNull(),
    lastMessageAt: timestamp('last_message_at', { withTimezone: true }).notNull().defaultNow(),
    createdAt: createdAt(),
  },
  (t) => [
    unique('conversations_user_system_uq').on(t.userPhone, t.systemPhone),
    index('conversations_recency').on(t.lastMessageAt, t.id),
  ],
);

export const messages = pgTable(
  'messages',
  {
    id: id(),
    conversationId: uuid('conversation_id')
      .notNull()
      .references(() => conversations.id),
    direction: text().$type<MessageDirection>().notNull(),
    body: text().notNull(),
    status: text().$type<MessageStatus>().notNull(),
    providerMessageSid: text('provider_message_sid'),
    idempotencyKey: text('idempotency_key'),
    inReplyTo: uuid('in_reply_to').references((): AnyPgColumn => messages.id),
    errorDetail: text('error_detail'),
    createdAt: createdAt(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // Idempotency layer: inbound SID dedup and outbound idempotency-key dedup are
    // direction-scoped, hence partial unique indexes rather than table-wide.
    uniqueIndex('messages_inbound_sid')
      .on(t.providerMessageSid)
      .where(sql`${t.direction} = 'inbound'`),
    uniqueIndex('messages_outbound_key')
      .on(t.idempotencyKey)
      .where(sql`${t.direction} = 'outbound'`),
    index('messages_conversation').on(t.conversationId, t.createdAt),
    check('messages_direction_check', sql`${t.direction} in ('inbound', 'outbound')`),
    check(
      'messages_status_check',
      sql`${t.status} in ('received', 'processing', 'processed', 'queued', 'sending', 'sent', 'failed')`,
    ),
  ],
);

export const jobs = pgTable(
  'jobs',
  {
    id: id(),
    inboundMessageId: uuid('inbound_message_id')
      .notNull()
      .unique()
      .references(() => messages.id),
    // Denormalized so the serialized claim predicate needs no join (§4).
    conversationId: uuid('conversation_id')
      .notNull()
      .references(() => conversations.id),
    status: text().$type<JobStatus>().notNull().default('pending'),
    attempts: integer().notNull().default(0),
    maxAttempts: integer('max_attempts').notNull().default(3),
    nextRunAt: timestamp('next_run_at', { withTimezone: true }).notNull().defaultNow(),
    lockedBy: text('locked_by'),
    leaseExpiresAt: timestamp('lease_expires_at', { withTimezone: true }),
    lastError: text('last_error'),
    createdAt: createdAt(),
  },
  (t) => [
    check('jobs_status_check', sql`${t.status} in ('pending', 'running', 'completed', 'failed')`),
    index('jobs_claim')
      .on(t.status, t.nextRunAt)
      .where(sql`${t.status} = 'pending'`),
    index('jobs_conversation_open')
      .on(t.conversationId, t.createdAt)
      .where(sql`${t.status} in ('pending', 'running')`),
    // The serialization GUARANTEE (§5.1.1): two running jobs of one conversation
    // become unrepresentable at the storage layer.
    uniqueIndex('one_running_per_conversation')
      .on(t.conversationId)
      .where(sql`${t.status} = 'running'`),
  ],
);

export const webhookEvents = pgTable('webhook_events', {
  id: id(),
  providerSid: text('provider_sid').notNull().unique(),
  payload: jsonb().notNull(),
  receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
});

export const workerHeartbeats = pgTable('worker_heartbeats', {
  workerId: text('worker_id').primaryKey(),
  lastBeatAt: timestamp('last_beat_at', { withTimezone: true }).notNull().defaultNow(),
});
