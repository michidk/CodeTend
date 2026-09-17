/** Whether the global queue may dispatch its next repository at `now`. */
export function isScheduleDispatchReady(
  lastDispatchedAt: Date | null,
  cooldownMinutes: number,
  now: Date,
): boolean {
  if (!lastDispatchedAt) return true
  return lastDispatchedAt.getTime() + cooldownMinutes * 60_000 <= now.getTime()
}

/** Round-robin selection for repositories inheriting the distributed mode. */
export function selectNextDistributedRepositoryId(
  repositoryIds: readonly number[],
  lastRepositoryId: number | null,
): number | null {
  const sortedIds = [...repositoryIds].sort((left, right) => left - right)
  const firstRepositoryId = sortedIds[0]
  if (firstRepositoryId === undefined) return null
  if (lastRepositoryId === null) return firstRepositoryId
  return (
    sortedIds.find((repositoryId) => repositoryId > lastRepositoryId) ??
    firstRepositoryId
  )
}
