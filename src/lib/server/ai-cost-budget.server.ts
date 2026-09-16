import '@tanstack/react-start/server-only'

import { gte, sql } from 'drizzle-orm'
import { db } from '@/db'
import { findingPatches, scans } from '@/db/schema'
import { hasReachedDailyAiCostBudget } from '@/lib/ai-cost-budget'
import { ensureScheduleSettingsRow } from '@/lib/server/schedule-settings'

export async function isDailyAiCostBudgetReached(): Promise<boolean> {
  const { maxDailyCostUsd } = await ensureScheduleSettingsRow()
  if (maxDailyCostUsd === null) return false

  const today = new Date()
  today.setUTCHours(0, 0, 0, 0)
  const [[scanUsage], [patchUsage]] = await Promise.all([
    db
      .select({
        cost: sql<number>`coalesce(sum(${scans.estimatedCostUsd}), 0)::float8`,
      })
      .from(scans)
      .where(gte(scans.createdAt, today)),
    db
      .select({
        cost: sql<number>`coalesce(sum(${findingPatches.estimatedCostUsd}), 0)::float8`,
      })
      .from(findingPatches)
      .where(gte(findingPatches.createdAt, today)),
  ])

  return hasReachedDailyAiCostBudget(maxDailyCostUsd, {
    scanCostUsd: scanUsage?.cost ?? 0,
    patchCostUsd: patchUsage?.cost ?? 0,
  })
}
