import { createServerFn } from '@tanstack/react-start'
import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '@/db'
import { scanScheduleSettings, scheduledRepositoryQueue } from '@/db/schema'
import { expectReturnedRow } from '@/lib/domain-errors'
import {
  computeNextDistributedScanAt,
  computeNextScanAt,
  isValidCronExpression,
  SCHEDULE_MODES,
  type ScheduleMode,
} from '@/lib/schedule'
import { MAX_SCAN_INPUT_TOKEN_BUDGET } from '@/lib/security-scans'

const SETTINGS_ID = 1

const scheduleSettingsInputSchema = z.object({
  mode: z.enum(SCHEDULE_MODES),
  cronExpression: z
    .string()
    .trim()
    .min(9)
    .max(100)
    .refine(isValidCronExpression, 'Enter a valid 5-field cron expression'),
  enabled: z.boolean(),
  scansPerDay: z.number().int().min(1).max(1_440),
  cooldownMinutes: z.number().int().min(0).max(10_080),
  maxInputTokens: z.number().int().min(10_000).max(MAX_SCAN_INPUT_TOKEN_BUDGET),
  maxDailyCostUsd: z.number().positive().nullable(),
  defaultScanCostUsd: z.number().positive().nullable(),
})

function computeNextGlobalRunAt(
  mode: ScheduleMode,
  cronExpression: string,
  scansPerDay: number,
  from: Date,
) {
  return mode === 'distributed'
    ? computeNextDistributedScanAt(scansPerDay, from)
    : computeNextScanAt(cronExpression, from)
}

export async function ensureScheduleSettingsRow() {
  const current = await db.query.scanScheduleSettings.findFirst({
    where: eq(scanScheduleSettings.id, SETTINGS_ID),
  })
  if (current) return current

  await db
    .insert(scanScheduleSettings)
    .values({
      id: SETTINGS_ID,
      nextRunAt: computeNextScanAt('0 3 * * *', new Date()),
    })
    .onConflictDoNothing()

  const created = await db.query.scanScheduleSettings.findFirst({
    where: eq(scanScheduleSettings.id, SETTINGS_ID),
  })
  if (!created) {
    throw new Error('Could not initialize scan schedule')
  }
  return created
}

export const getScheduleSettings = createServerFn({ method: 'GET' }).handler(
  async () => {
    const { ensureScheduler } = await import('@/lib/server/scheduler.server')
    ensureScheduler()
    const settings = await ensureScheduleSettingsRow()
    const queued = await db.$count(scheduledRepositoryQueue)
    return { ...settings, queuedRepositories: queued }
  },
)

export const updateScheduleSettings = createServerFn({ method: 'POST' })
  .validator(scheduleSettingsInputSchema)
  .handler(async ({ data }) => {
    const current = await ensureScheduleSettingsRow()
    const scheduleChanged =
      current.mode !== data.mode ||
      (data.mode === 'cron'
        ? current.cronExpression !== data.cronExpression
        : current.scansPerDay !== data.scansPerDay)

    const [updated] = await db
      .update(scanScheduleSettings)
      .set({
        ...data,
        nextRunAt: data.enabled
          ? scheduleChanged || !current.nextRunAt || !current.enabled
            ? computeNextGlobalRunAt(
                data.mode,
                data.cronExpression,
                data.scansPerDay,
                new Date(),
              )
            : current.nextRunAt
          : null,
        updatedAt: new Date(),
      })
      .where(eq(scanScheduleSettings.id, SETTINGS_ID))
      .returning()

    if (!data.enabled) await db.delete(scheduledRepositoryQueue)
    return expectReturnedRow(updated, 'Scan schedule')
  })
