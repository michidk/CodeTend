ALTER TABLE "finding_patches" ADD COLUMN "eve_session_id" text;--> statement-breakpoint
ALTER TABLE "finding_patches" ADD COLUMN "model" text;--> statement-breakpoint
ALTER TABLE "finding_patches" ADD COLUMN "input_tokens" integer;--> statement-breakpoint
ALTER TABLE "finding_patches" ADD COLUMN "output_tokens" integer;--> statement-breakpoint
ALTER TABLE "finding_patches" ADD COLUMN "cache_read_tokens" integer;--> statement-breakpoint
ALTER TABLE "finding_patches" ADD COLUMN "cache_write_tokens" integer;--> statement-breakpoint
ALTER TABLE "finding_patches" ADD COLUMN "estimated_cost_usd" real;--> statement-breakpoint
ALTER TABLE "finding_patches" ADD COLUMN "model_calls" integer;--> statement-breakpoint
CREATE UNIQUE INDEX "finding_patches_active_idx" ON "finding_patches" USING btree ("finding_id") WHERE "finding_patches"."status" in ('generating', 'proposed', 'verified');