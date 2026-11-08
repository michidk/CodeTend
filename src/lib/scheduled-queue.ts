/** Whether the global queue may dispatch its next repository at `now`. */
export function isScheduleDispatchReady(
  lastDispatchedAt: Date | null,
  cooldownMinutes: number,
  now: Date,
): boolean {
  if (!lastDispatchedAt) return true
  return lastDispatchedAt.getTime() + cooldownMinutes * 60_000 <= now.getTime()
}

/** Unrated first; waiting time starts at the last attempt or registration. */
export function compareByLastScan(
  left: {
    id: number
    hasRating: boolean
    createdAt: Date
    lastScanAt: Date | null
  },
  right: {
    id: number
    hasRating: boolean
    createdAt: Date
    lastScanAt: Date | null
  },
): number {
  if (left.hasRating !== right.hasRating) return left.hasRating ? 1 : -1
  return (
    (left.lastScanAt ?? left.createdAt).getTime() -
      (right.lastScanAt ?? right.createdAt).getTime() || left.id - right.id
  )
}
