/** Whether the global queue may dispatch its next repository at `now`. */
export function isScheduleDispatchReady(
  lastDispatchedAt: Date | null,
  cooldownMinutes: number,
  now: Date,
): boolean {
  if (!lastDispatchedAt) return true
  return lastDispatchedAt.getTime() + cooldownMinutes * 60_000 <= now.getTime()
}
