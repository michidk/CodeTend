import { LoaderCircle } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import {
  type ScanProgress as ScanProgressValue,
  scanProgressPercent,
} from '@/lib/scan-progress'

export function ScanProgress({
  progress,
}: {
  readonly progress: ScanProgressValue
}) {
  const percent = scanProgressPercent(progress)

  return (
    <Card aria-live="polite">
      <CardContent className="space-y-3">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="flex items-center gap-2 font-semibold capitalize">
              <LoaderCircle
                className="size-4 shrink-0 animate-spin text-link motion-reduce:animate-none"
                aria-hidden="true"
              />
              {progress.phase}
            </p>
            {progress.detail ? (
              <p className="mt-1 truncate text-xs text-muted-foreground">
                {progress.detail}
              </p>
            ) : null}
          </div>
          <span className="shrink-0 font-mono text-sm font-semibold tabular-nums">
            {Math.round(percent)}%
          </span>
        </div>

        <div
          role="progressbar"
          aria-label="Scan progress"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(percent)}
          className="h-2 overflow-hidden rounded-full bg-muted"
        >
          <div
            className="h-full rounded-full bg-link transition-[width] duration-500 motion-reduce:transition-none"
            style={{ width: `${percent}%` }}
          />
        </div>

        <div className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted-foreground">
          <span>
            {progress.completed} of {progress.total} workflow steps complete
          </span>
          {progress.scannerTotal !== undefined ? (
            <span>
              {progress.scannerCompleted ?? 0} of {progress.scannerTotal}{' '}
              scanners complete
            </span>
          ) : null}
          {progress.targetFileCount !== undefined ? (
            <span>{progress.targetFileCount} target files selected</span>
          ) : null}
        </div>
      </CardContent>
    </Card>
  )
}
