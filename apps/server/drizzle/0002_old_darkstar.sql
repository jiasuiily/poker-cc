ALTER TABLE "invite_codes" ADD COLUMN "reusable" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "invite_codes" ADD COLUMN "uses" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
UPDATE "invite_codes" SET "uses" = 1 WHERE "used_by" IS NOT NULL;
