/** Whether the global queue may dispatch its next repository at `now`. */
export function isScheduleDispatchReady(
  lastDispatchedAt: Date | null,
  cooldownMinutes: number,
  now: Date,
): boolean {
  if (!lastDispatchedAt) return true
  return lastDispatchedAt.getTime() + cooldownMinutes * 60_000 <= now.getTime()
}

/** Orders unrated repositories first, then the oldest scan attempt. */
export function compareByLastScan(
  left: { id: number; hasRating: boolean; lastScanAt: Date | null },
  right: { id: number; hasRating: boolean; lastScanAt: Date | null },
): number {
  if (left.hasRating !== right.hasRating) return left.hasRating ? 1 : -1
  if (!left.lastScanAt !== !right.lastScanAt) return left.lastScanAt ? 1 : -1
  return (
    (left.lastScanAt?.getTime() ?? 0) - (right.lastScanAt?.getTime() ?? 0) ||
    left.id - right.id
  )
}
