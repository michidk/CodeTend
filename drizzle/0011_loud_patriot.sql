CREATE TABLE "scan_schedule_settings" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"cron_expression" text DEFAULT '0 3 * * *' NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"cooldown_minutes" integer DEFAULT 5 NOT NULL,
	"next_run_at" timestamp with time zone,
	"last_dispatched_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
INSERT INTO "scan_schedule_settings" (
	"id",
	"cron_expression",
	"enabled",
	"cooldown_minutes",
	"next_run_at"
)
SELECT
	1,
	COALESCE(
		(SELECT "cron_expression" FROM "repositories" WHERE "enabled" = true ORDER BY "id" LIMIT 1),
		'0 3 * * *'
	),
	COALESCE(bool_or("enabled"), true),
	5,
	CASE
		WHEN COALESCE(bool_or("enabled"), true)
		THEN COALESCE(min("next_scan_at") FILTER (WHERE "enabled" = true), now())
		ELSE NULL
	END
FROM "repositories";
--> statement-breakpoint
CREATE TABLE "scheduled_repository_queue" (
	"id" serial PRIMARY KEY NOT NULL,
	"repository_id" integer NOT NULL,
	"enqueued_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "scheduled_repository_queue" ADD CONSTRAINT "scheduled_repository_queue_repository_id_repositories_id_fk" FOREIGN KEY ("repository_id") REFERENCES "public"."repositories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "scheduled_repository_queue_repository_idx" ON "scheduled_repository_queue" USING btree ("repository_id");--> statement-breakpoint
CREATE INDEX "scheduled_repository_queue_enqueued_idx" ON "scheduled_repository_queue" USING btree ("enqueued_at");--> statement-breakpoint
ALTER TABLE "repositories" DROP COLUMN "cron_expression";--> statement-breakpoint
ALTER TABLE "repositories" DROP COLUMN "enabled";--> statement-breakpoint
ALTER TABLE "repositories" DROP COLUMN "next_scan_at";
