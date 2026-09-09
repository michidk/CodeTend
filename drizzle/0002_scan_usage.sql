ALTER TABLE "scanner_runs" ADD COLUMN "input_tokens" integer;--> statement-breakpoint
ALTER TABLE "scanner_runs" ADD COLUMN "output_tokens" integer;--> statement-breakpoint
ALTER TABLE "scanner_runs" ADD COLUMN "cache_read_tokens" integer;--> statement-breakpoint
ALTER TABLE "scanner_runs" ADD COLUMN "cache_write_tokens" integer;--> statement-breakpoint
ALTER TABLE "scanner_runs" ADD COLUMN "estimated_cost_usd" real;--> statement-breakpoint
ALTER TABLE "scanner_runs" ADD COLUMN "model_calls" integer;--> statement-breakpoint
ALTER TABLE "scans" ADD COLUMN "model" text;--> statement-breakpoint
ALTER TABLE "scans" ADD COLUMN "input_tokens" integer;--> statement-breakpoint
ALTER TABLE "scans" ADD COLUMN "output_tokens" integer;--> statement-breakpoint
ALTER TABLE "scans" ADD COLUMN "cache_read_tokens" integer;--> statement-breakpoint
ALTER TABLE "scans" ADD COLUMN "cache_write_tokens" integer;--> statement-breakpoint
ALTER TABLE "scans" ADD COLUMN "estimated_cost_usd" real;--> statement-breakpoint
ALTER TABLE "scans" ADD COLUMN "model_calls" integer;