import { CronExpressionParser } from 'cron-parser'

export { CRON_PRESETS } from '@/lib/schedule-presets'

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
