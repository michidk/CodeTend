ALTER TABLE "finding_occurrences" ADD COLUMN "subject" jsonb;--> statement-breakpoint
ALTER TABLE "finding_occurrences" ADD COLUMN "evidence" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "findings" ADD COLUMN "subject" jsonb;--> statement-breakpoint
ALTER TABLE "findings" ADD COLUMN "evidence" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "scan_schedule_settings" ADD COLUMN "max_input_tokens" integer DEFAULT 250000 NOT NULL;--> statement-breakpoint
ALTER TABLE "scanner_runs" ADD COLUMN "investigation" jsonb;--> statement-breakpoint
ALTER TABLE "scans" ADD COLUMN "max_input_tokens" integer DEFAULT 250000 NOT NULL;--> statement-breakpoint
ALTER TABLE "scans" ADD COLUMN "investigation" jsonb;