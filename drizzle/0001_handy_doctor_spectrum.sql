ALTER TABLE "conversations" ALTER COLUMN "last_message_at" SET DEFAULT now();--> statement-breakpoint
UPDATE "conversations" SET "last_message_at" = "created_at" WHERE "last_message_at" IS NULL;--> statement-breakpoint
ALTER TABLE "conversations" ALTER COLUMN "last_message_at" SET NOT NULL;--> statement-breakpoint
CREATE INDEX "conversations_recency" ON "conversations" USING btree ("last_message_at","id");