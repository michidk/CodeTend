import { CronExpressionParser } from 'cron-parser'

export const CRON_PRESETS = [
  { label: 'Every 6 hours', value: '0 */6 * * *' },
  { label: 'Daily at 03:00', value: '0 3 * * *' },
  { label: 'Weekdays at 06:00', value: '0 6 * * 1-5' },
  { label: 'Weekly on Monday 03:00', value: '0 3 * * 1' },
] as const

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

export function describeCron(expression: string): string {
  const preset = CRON_PRESETS.find((entry) => entry.value === expression)
  return preset ? preset.label : expression
}
