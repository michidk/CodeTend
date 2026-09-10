/**
 * Display-only schedule helpers. Kept free of `cron-parser` so list pages can
 * label a schedule without shipping the parser (and luxon) to the client.
 */
export const CRON_PRESETS = [
  { label: 'Every 6 hours', value: '0 */6 * * *' },
  { label: 'Daily at 03:00', value: '0 3 * * *' },
  { label: 'Weekdays at 06:00', value: '0 6 * * 1-5' },
  { label: 'Weekly on Monday 03:00', value: '0 3 * * 1' },
] as const

export function describeCron(expression: string): string {
  const preset = CRON_PRESETS.find((entry) => entry.value === expression)
  return preset ? preset.label : expression
}
