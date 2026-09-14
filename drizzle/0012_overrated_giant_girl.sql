ALTER TABLE "scan_schedule_settings" ADD COLUMN "max_files" integer DEFAULT 300 NOT NULL;--> statement-breakpoint
ALTER TABLE "scans" ADD COLUMN "max_files" integer DEFAULT 300 NOT NULL;--> statement-breakpoint
ALTER TABLE "scans" ADD COLUMN "reviewed_file_count" integer;--> statement-breakpoint
ALTER TABLE "scans" ADD COLUMN "target_file_count" integer;