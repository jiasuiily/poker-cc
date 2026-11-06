CREATE TABLE "hand_analyses" (
	"hand_id" text NOT NULL,
	"player_id" text NOT NULL,
	"engine_version" integer NOT NULL,
	"decisions" jsonb NOT NULL,
	"llm_text" text,
	"llm_status" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "hand_analyses_hand_id_player_id_pk" PRIMARY KEY("hand_id","player_id")
);
--> statement-breakpoint
CREATE TABLE "hand_players" (
	"hand_id" text NOT NULL,
	"player_id" text NOT NULL,
	"seat" integer NOT NULL,
	"net" integer NOT NULL,
	"ended_at" timestamp with time zone NOT NULL,
	CONSTRAINT "hand_players_hand_id_player_id_pk" PRIMARY KEY("hand_id","player_id")
);
--> statement-breakpoint
CREATE TABLE "hands" (
	"id" text PRIMARY KEY NOT NULL,
	"table_id" text NOT NULL,
	"table_name" text NOT NULL,
	"hand_no" integer NOT NULL,
	"small_blind" integer NOT NULL,
	"big_blind" integer NOT NULL,
	"max_seats" integer NOT NULL,
	"button" integer NOT NULL,
	"seats" jsonb NOT NULL,
	"events" jsonb NOT NULL,
	"result" jsonb NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"ended_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "llm_usage" (
	"player_id" text NOT NULL,
	"day" text NOT NULL,
	"count" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "llm_usage_player_id_day_pk" PRIMARY KEY("player_id","day")
);
--> statement-breakpoint
CREATE TABLE "players" (
	"id" text PRIMARY KEY NOT NULL,
	"nickname" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "players_nickname_unique" UNIQUE("nickname")
);
--> statement-breakpoint
ALTER TABLE "hand_analyses" ADD CONSTRAINT "hand_analyses_hand_id_hands_id_fk" FOREIGN KEY ("hand_id") REFERENCES "public"."hands"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hand_players" ADD CONSTRAINT "hand_players_hand_id_hands_id_fk" FOREIGN KEY ("hand_id") REFERENCES "public"."hands"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "hand_players_player_ended" ON "hand_players" USING btree ("player_id","ended_at" desc,"hand_id" desc);