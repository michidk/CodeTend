-- The "abstraction" scanner was merged into "duplication" (now "Duplication &
-- Abstraction"). Re-parent its logical findings so they are handed to the
-- merged scanner as hypotheses and keep their occurrence history. A fingerprint
-- that already exists for the duplication scanner of the same repository is
-- suffixed to satisfy the unique index; the merged scanner reconciles the two
-- on its next run. Historical scanner_runs rows keep their original scanner_id
-- as a record of what actually ran.
UPDATE "findings" AS f
SET "fingerprint" = f."fingerprint" || '-abstraction'
WHERE f."scanner_id" = 'abstraction'
  AND EXISTS (
    SELECT 1 FROM "findings" AS d
    WHERE d."repository_id" = f."repository_id"
      AND d."scanner_id" = 'duplication'
      AND d."fingerprint" = f."fingerprint"
  );--> statement-breakpoint
UPDATE "findings"
SET "scanner_id" = 'duplication', "updated_at" = now()
WHERE "scanner_id" = 'abstraction';
