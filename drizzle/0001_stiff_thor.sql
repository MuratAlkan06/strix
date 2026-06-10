ALTER TYPE "public"."weekly_feeling" ADD VALUE 'skipped';--> statement-breakpoint
DROP INDEX "goal_drafts_session_token_idx";--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN "superseded_at" timestamp with time zone;--> statement-breakpoint
CREATE UNIQUE INDEX "goal_drafts_session_token_idx" ON "goal_drafts" USING btree ("session_token");