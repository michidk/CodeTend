DROP INDEX "finding_patches_active_idx";--> statement-breakpoint
ALTER TABLE "finding_patches" ADD COLUMN "pull_request" jsonb;--> statement-breakpoint
CREATE UNIQUE INDEX "finding_patches_active_idx" ON "finding_patches" USING btree ("finding_id") WHERE "finding_patches"."status" in ('generating', 'proposed', 'verified', 'published');