import { CronExpressionParser } from 'cron-parser'

export { CRON_PRESETS } from '@/lib/schedule-presets'

export const SCHEDULE_MODES = ['cron', 'distributed'] as const
export type ScheduleMode = (typeof SCHEDULE_MODES)[number]

export function isValidCronExpression(expression: string): boolean {
  try {
    CronExpressionParser.parse(expression)
    return true
  } catch {
    return false
  }
}

/** Next occurrence strictly after `from`, in UTC. */
export function computeNextScanAt(expression: string, from: Date): Date {
  const interval = CronExpressionParser.parse(expression, {
    currentDate: from,
    tz: 'UTC',
  })
  return interval.next().toDate()
}

/** Next evenly spaced slot for a target number of scans per UTC day. */
export function computeNextDistributedScanAt(
  scansPerDay: number,
  from: Date,
): Date {
  if (!Number.isInteger(scansPerDay) || scansPerDay < 1) {
    throw new RangeError('scansPerDay must be a positive integer')
  }
  return new Date(from.getTime() + 86_400_000 / scansPerDay)
}
