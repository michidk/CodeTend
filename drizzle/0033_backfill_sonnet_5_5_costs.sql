-- First-party Sonnet 5.5 USD/MTok: input 2, output 10, cache read 0.10,
-- five-minute cache write 2.50. Preserve existing costs and absent usage.
UPDATE scans
SET estimated_cost_usd = (
  input_tokens::double precision * 2 + output_tokens::double precision * 10 +
  cache_read_tokens::double precision * 0.10 + cache_write_tokens::double precision * 2.50
) / 1000000
WHERE estimated_cost_usd IS NULL
  AND status IN ('completed', 'partial', 'failed', 'cancelled')
  AND regexp_replace(regexp_replace(lower(model), '^.*/', ''), '-[0-9]{8}$', '') = 'claude-sonnet-5-5'
  AND input_tokens IS NOT NULL AND output_tokens IS NOT NULL
  AND cache_read_tokens IS NOT NULL AND cache_write_tokens IS NOT NULL;
--> statement-breakpoint
UPDATE scanner_runs
SET estimated_cost_usd = (
  input_tokens::double precision * 2 + output_tokens::double precision * 10 +
  cache_read_tokens::double precision * 0.10 + cache_write_tokens::double precision * 2.50
) / 1000000
WHERE estimated_cost_usd IS NULL
  AND status IN ('completed', 'failed', 'cancelled')
  AND regexp_replace(regexp_replace(lower(requested_model), '^.*/', ''), '-[0-9]{8}$', '') = 'claude-sonnet-5-5'
  AND input_tokens IS NOT NULL AND output_tokens IS NOT NULL
  AND cache_read_tokens IS NOT NULL AND cache_write_tokens IS NOT NULL;
