ALTER TABLE "conversations" ALTER COLUMN "last_message_at" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "conversations" ALTER COLUMN "last_message_at" SET NOT NULL;--> statement-breakpoint
CREATE INDEX "conversations_recency" ON "conversations" USING btree ("last_message_at","id");