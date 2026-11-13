interface PositionedEntry {
  readonly id: number
  readonly position: number | null
}

const AUTOMATIC_RANK_STEP = 1024

function rankedEntries<Entry extends PositionedEntry>(
  entries: readonly Entry[],
) {
  return entries
    .map((entry, index) => ({
      entry,
      rank: entry.position ?? index * AUTOMATIC_RANK_STEP,
    }))
    .sort(
      (left, right) => left.rank - right.rank || left.entry.id - right.entry.id,
    )
}

/** Untouched repositories receive ranks from the current automatic algorithm. */
export function applySchedulePositions<Entry extends PositionedEntry>(
  entries: readonly Entry[],
): Entry[] {
  return rankedEntries(entries).map(({ entry }) => entry)
}

/** A move saves just the dragged row's key between its new neighbors. */
export function getScheduleMovePosition(
  entries: readonly PositionedEntry[],
  id: number,
  index: number,
): number {
  const remaining = rankedEntries(entries).filter(
    ({ entry }) => entry.id !== id,
  )
  const target = Math.max(0, Math.min(index, remaining.length))
  const left = remaining[target - 1]?.rank
  const right = remaining[target]?.rank
  const lower = left ?? (right ?? 0) - 2 * AUTOMATIC_RANK_STEP
  const upper = right ?? (left ?? 0) + 2 * AUTOMATIC_RANK_STEP
  let position = (lower + upper) / 2
  // Integer ranks belong to automatic entries, including ones added later.
  if (Number.isInteger(position))
    position += Math.min(0.5, (upper - position) / 2)
  if (position <= lower || position >= upper || Number.isInteger(position)) {
    throw new Error(
      'These positions are too close. Reset a manual position before moving again.',
    )
  }
  return position
}
