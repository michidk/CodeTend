const relativeFormatter = new Intl.RelativeTimeFormat('en', { numeric: 'auto' })

const UNITS: readonly [Intl.RelativeTimeFormatUnit, number][] = [
  ['year', 365 * 24 * 3600],
  ['month', 30 * 24 * 3600],
  ['week', 7 * 24 * 3600],
  ['day', 24 * 3600],
  ['hour', 3600],
  ['minute', 60],
]

/** "3 hours ago" / "in 2 days"; falls back to "just now" under a minute. */
export function formatRelative(
  value: Date | string | null | undefined,
  now = new Date(),
): string {
  if (!value) return 'never'
  const date = new Date(value)
  const seconds = Math.round((date.getTime() - now.getTime()) / 1000)
  for (const [unit, size] of UNITS) {
    if (Math.abs(seconds) >= size) {
      return relativeFormatter.format(Math.round(seconds / size), unit)
    }
  }
  return seconds <= 0 ? 'just now' : 'in under a minute'
}

export function formatDateTime(
  value: Date | string | null | undefined,
): string {
  if (!value) return '–'
  return new Date(value).toLocaleString('en-GB', {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function formatShortDate(value: Date | string): string {
  return new Date(value).toLocaleDateString('en-GB', {
    month: 'short',
    day: '2-digit',
  })
}

export function formatDuration(
  start: Date | string | null | undefined,
  end: Date | string | null | undefined,
): string {
  if (!start || !end) return '–'
  const seconds = Math.max(
    0,
    Math.round((new Date(end).getTime() - new Date(start).getTime()) / 1000),
  )
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  return `${minutes}m ${seconds % 60}s`
}

export function shortSha(sha: string | null | undefined): string {
  return sha ? sha.slice(0, 8) : '–'
}
