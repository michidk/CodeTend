ALTER TABLE "repositories" ADD COLUMN "schedule_cron_expression" text;--> statement-breakpoint
ALTER TABLE "repositories" ADD COLUMN "next_scheduled_scan_at" timestamp with time zone;