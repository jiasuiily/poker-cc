CREATE TABLE "coach_reports" (
	"id" text PRIMARY KEY NOT NULL,
	"player_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"status" text NOT NULL,
	"stats" jsonb NOT NULL,
	"text" text
);
--> statement-breakpoint
ALTER TABLE "llm_usage" ADD COLUMN "kind" text DEFAULT 'hand' NOT NULL;--> statement-breakpoint
ALTER TABLE "llm_usage" DROP CONSTRAINT "llm_usage_player_id_day_pk";--> statement-breakpoint
ALTER TABLE "llm_usage" ADD CONSTRAINT "llm_usage_player_id_day_kind_pk" PRIMARY KEY("player_id","day","kind");--> statement-breakpoint
ALTER TABLE "players" ADD COLUMN "last_login_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "players" ADD COLUMN "login_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "players" ADD COLUMN "last_seen_at" timestamp with time zone;--> statement-breakpoint
CREATE UNIQUE INDEX "coach_reports_one_pending" ON "coach_reports" USING btree ("player_id") WHERE "coach_reports"."status" = 'pending';