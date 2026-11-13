# Schedule

Add a Schedule navigation entry showing the upcoming global scan rotation. Drag and drop or use move buttons to reprioritize a repository; Save changes writes only explicitly moved/reset repositories. Manual positions apply once and are removed when the scheduled scan starts. A per-row Reset to automatic removes that override. The existing unrated-first/waiting-time algorithm orders all other repositories at read and dispatch time.

Custom cron schedules remain separate and retain their due times. Archived, disabled and currently running repositories cannot be moved. The page shows scheduler state, next slot and queue state; timing remains subject to cooldown, capacity and budget. Global settings remain in Settings.

## Approaches

Persisting the entire displayed order would freeze automatic priorities and conflicts with the requested sparse saves. Persisting only next-run position overrides preserves automatic ordering and is the chosen approach. Permanent priority weights would affect future reruns, beyond the requested next-run adjustment.

## Validation and release

Test sparse position application, reset, ties and automatic fallback, run repository verification and database smoke checks, then publish signed API commits to main. Deploy immutable images through the sibling k8s repository and verify rollout and logs.
