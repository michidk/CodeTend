UPDATE "scans"
SET "status" = 'completed',
	"error" = NULL
WHERE "status" = 'partial'
	AND "error" LIKE 'The investigation exceeded its % input-token budget.'
	AND NOT EXISTS (
		SELECT 1
		FROM "scanner_runs"
		WHERE "scanner_runs"."scan_id" = "scans"."id"
			AND "scanner_runs"."status" = 'failed'
	);
