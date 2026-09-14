export interface ScanProgress {
  readonly phase: string
  readonly detail?: string
  readonly completed: number
  readonly total: number
  readonly scannerCompleted?: number
  readonly scannerTotal?: number
  readonly targetFileCount?: number
}

export function scanProgressPercent(progress: ScanProgress): number {
  if (progress.total <= 0) return 0
  return Math.min(100, Math.max(0, (progress.completed / progress.total) * 100))
}
