DROP INDEX "finding_patches_active_idx";--> statement-breakpoint
ALTER TABLE "finding_patches" ADD COLUMN "requested_model" text DEFAULT 'gpt-5.6-sol' NOT NULL;--> statement-breakpoint
ALTER TABLE "finding_patches" ADD COLUMN "requested_effort" text DEFAULT 'medium' NOT NULL;--> statement-breakpoint
ALTER TABLE "finding_patches" ADD COLUMN "started_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "finding_patches" ADD COLUMN "finished_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "global_scanner_settings" ADD COLUMN "model" text;--> statement-breakpoint
ALTER TABLE "global_scanner_settings" ADD COLUMN "effort" text;--> statement-breakpoint
ALTER TABLE "scan_schedule_settings" ADD COLUMN "scan_concurrency" integer DEFAULT 2 NOT NULL;--> statement-breakpoint
ALTER TABLE "scan_schedule_settings" ADD COLUMN "fix_concurrency" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "scan_schedule_settings" ADD COLUMN "scan_model" text DEFAULT 'gpt-5.6-sol' NOT NULL;--> statement-breakpoint
ALTER TABLE "scan_schedule_settings" ADD COLUMN "scan_effort" text DEFAULT 'medium' NOT NULL;--> statement-breakpoint
ALTER TABLE "scan_schedule_settings" ADD COLUMN "fix_model" text DEFAULT 'gpt-5.6-sol' NOT NULL;--> statement-breakpoint
ALTER TABLE "scan_schedule_settings" ADD COLUMN "fix_effort" text DEFAULT 'medium' NOT NULL;--> statement-breakpoint
ALTER TABLE "scanner_runs" ADD COLUMN "requested_model" text DEFAULT 'gpt-5.6-sol' NOT NULL;--> statement-breakpoint
ALTER TABLE "scanner_runs" ADD COLUMN "requested_effort" text DEFAULT 'medium' NOT NULL;--> statement-breakpoint
ALTER TABLE "scans" ADD COLUMN "requested_model" text DEFAULT 'gpt-5.6-sol' NOT NULL;--> statement-breakpoint
ALTER TABLE "scans" ADD COLUMN "requested_effort" text DEFAULT 'medium' NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "finding_patches_active_idx" ON "finding_patches" USING btree ("finding_id") WHERE "finding_patches"."status" in ('queued', 'generating', 'proposed', 'verified', 'published');