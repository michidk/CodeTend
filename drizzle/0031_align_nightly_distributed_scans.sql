WITH overnight AS (
  SELECT (date_trunc('day', now() AT TIME ZONE 'UTC') + interval '3 hours')
    AT TIME ZONE 'UTC' AS slot
)
UPDATE scan_schedule_settings
SET next_run_at = CASE WHEN overnight.slot > now() THEN overnight.slot
                      ELSE overnight.slot + interval '24 hours' END,
    updated_at = now()
FROM overnight
WHERE mode = 'distributed' AND scans_per_day = 1 AND enabled = true;
