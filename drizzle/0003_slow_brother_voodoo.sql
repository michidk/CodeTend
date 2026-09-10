ALTER TABLE "finding_occurrences" ADD COLUMN "classification" jsonb;--> statement-breakpoint
ALTER TABLE "finding_occurrences" ADD COLUMN "security_context" jsonb;--> statement-breakpoint
ALTER TABLE "finding_occurrences" ADD COLUMN "vulnerability" jsonb;--> statement-breakpoint
ALTER TABLE "finding_occurrences" ADD COLUMN "priority" text;--> statement-breakpoint
ALTER TABLE "finding_occurrences" ADD COLUMN "priority_score" real;--> statement-breakpoint
ALTER TABLE "finding_occurrences" ADD COLUMN "priority_reasons" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "findings" ADD COLUMN "classification" jsonb;--> statement-breakpoint
ALTER TABLE "findings" ADD COLUMN "security_context" jsonb;--> statement-breakpoint
ALTER TABLE "findings" ADD COLUMN "vulnerability" jsonb;--> statement-breakpoint
ALTER TABLE "findings" ADD COLUMN "priority" text;--> statement-breakpoint
ALTER TABLE "findings" ADD COLUMN "priority_score" real;--> statement-breakpoint
ALTER TABLE "findings" ADD COLUMN "priority_reasons" jsonb DEFAULT '[]'::jsonb NOT NULL;