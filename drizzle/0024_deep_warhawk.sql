ALTER TABLE "scan_schedule_settings" ADD COLUMN "mode" text DEFAULT 'cron' NOT NULL;--> statement-breakpoint
ALTER TABLE "scan_schedule_settings" ADD COLUMN "scans_per_day" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "scan_schedule_settings" ADD COLUMN "last_distributed_repository_id" integer;