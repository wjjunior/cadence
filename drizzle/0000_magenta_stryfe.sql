CREATE TABLE "conversations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_phone" text NOT NULL,
	"system_phone" text NOT NULL,
	"last_message_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "conversations_user_system_uq" UNIQUE("user_phone","system_phone")
);
--> statement-breakpoint
CREATE TABLE "jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"inbound_message_id" uuid NOT NULL,
	"conversation_id" uuid NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 3 NOT NULL,
	"next_run_at" timestamp with time zone DEFAULT now() NOT NULL,
	"locked_by" text,
	"lease_expires_at" timestamp with time zone,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "jobs_inbound_message_id_unique" UNIQUE("inbound_message_id"),
	CONSTRAINT "jobs_status_check" CHECK ("jobs"."status" in ('pending', 'running', 'completed', 'failed'))
);
--> statement-breakpoint
CREATE TABLE "messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"conversation_id" uuid NOT NULL,
	"direction" text NOT NULL,
	"body" text NOT NULL,
	"status" text NOT NULL,
	"provider_message_sid" text,
	"idempotency_key" text,
	"in_reply_to" uuid,
	"error_detail" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "messages_direction_check" CHECK ("messages"."direction" in ('inbound', 'outbound')),
	CONSTRAINT "messages_status_check" CHECK ("messages"."status" in ('received', 'processing', 'processed', 'queued', 'sending', 'sent', 'failed'))
);
--> statement-breakpoint
CREATE TABLE "webhook_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider_sid" text NOT NULL,
	"payload" jsonb NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "webhook_events_provider_sid_unique" UNIQUE("provider_sid")
);
--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_inbound_message_id_messages_id_fk" FOREIGN KEY ("inbound_message_id") REFERENCES "public"."messages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_in_reply_to_messages_id_fk" FOREIGN KEY ("in_reply_to") REFERENCES "public"."messages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "jobs_claim" ON "jobs" USING btree ("status","next_run_at") WHERE "jobs"."status" = 'pending';--> statement-breakpoint
CREATE INDEX "jobs_conversation_open" ON "jobs" USING btree ("conversation_id","created_at") WHERE "jobs"."status" in ('pending', 'running');--> statement-breakpoint
CREATE UNIQUE INDEX "one_running_per_conversation" ON "jobs" USING btree ("conversation_id") WHERE "jobs"."status" = 'running';--> statement-breakpoint
CREATE UNIQUE INDEX "messages_inbound_sid" ON "messages" USING btree ("provider_message_sid") WHERE "messages"."direction" = 'inbound';--> statement-breakpoint
CREATE UNIQUE INDEX "messages_outbound_key" ON "messages" USING btree ("idempotency_key") WHERE "messages"."direction" = 'outbound';--> statement-breakpoint
CREATE INDEX "messages_conversation" ON "messages" USING btree ("conversation_id","created_at");