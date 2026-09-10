ALTER TABLE "findings" ADD COLUMN "disposition" text;--> statement-breakpoint
ALTER TABLE "findings" ADD COLUMN "disposition_note" text;--> statement-breakpoint
ALTER TABLE "findings" ADD COLUMN "triaged_at" timestamp with time zone;--> statement-breakpoint
WITH "ranked_active_scans" AS (
	SELECT "id", row_number() OVER (PARTITION BY "repository_id" ORDER BY "created_at" DESC, "id" DESC) AS "position"
	FROM "scans"
	WHERE "status" IN ('queued', 'running')
)
UPDATE "scans"
SET "status" = 'failed',
	"phase" = 'failed',
	"error" = COALESCE("error", 'Superseded while enforcing one active scan per repository.'),
	"finished_at" = COALESCE("finished_at", now())
WHERE "id" IN (SELECT "id" FROM "ranked_active_scans" WHERE "position" > 1);--> statement-breakpoint
CREATE UNIQUE INDEX "scans_repository_active_idx" ON "scans" USING btree ("repository_id") WHERE "scans"."status" in ('queued', 'running');
