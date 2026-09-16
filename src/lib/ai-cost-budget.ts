export function hasReachedDailyAiCostBudget(
  maxDailyCostUsd: number | null,
  usage: { readonly scanCostUsd: number; readonly patchCostUsd: number },
): boolean {
  return (
    maxDailyCostUsd !== null &&
    usage.scanCostUsd + usage.patchCostUsd >= maxDailyCostUsd
  )
}
