ALTER TABLE "finding_occurrences" ADD COLUMN "exploitability" jsonb;--> statement-breakpoint
ALTER TABLE "findings" ADD COLUMN "exploitability" jsonb;