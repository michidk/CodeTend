/** Whether the global queue may dispatch its next repository at `now`. */
export function isScheduleDispatchReady(
  lastDispatchedAt: Date | null,
  cooldownMinutes: number,
  now: Date,
): boolean {
  if (!lastDispatchedAt) return true
  return lastDispatchedAt.getTime() + cooldownMinutes * 60_000 <= now.getTime()
}

/** Orders never-scanned repositories first, then the longest-unscanned. */
export function compareByLastScan(
  left: { id: number; lastScanAt: Date | null },
  right: { id: number; lastScanAt: Date | null },
): number {
  if (!left.lastScanAt !== !right.lastScanAt) return left.lastScanAt ? 1 : -1
  return (
    (left.lastScanAt?.getTime() ?? 0) - (right.lastScanAt?.getTime() ?? 0) ||
    left.id - right.id
  )
}
