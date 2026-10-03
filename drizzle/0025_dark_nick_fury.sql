DELETE FROM "finding_events" a USING "finding_events" b WHERE a."scan_id" IS NOT NULL AND a."finding_id" = b."finding_id" AND a."scan_id" = b."scan_id" AND a."kind" = b."kind" AND a."id" > b."id";--> statement-breakpoint
CREATE UNIQUE INDEX "finding_events_scan_kind_idx" ON "finding_events" USING btree ("finding_id","scan_id","kind") WHERE "finding_events"."scan_id" is not null;
