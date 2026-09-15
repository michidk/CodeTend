import { useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { getErrorMessage } from '@/lib/error-message'
import {
  DEFAULT_SCAN_INPUT_TOKEN_BUDGET,
  MAX_SCAN_INPUT_TOKEN_BUDGET,
  SCAN_INPUT_TOKEN_BUDGET_PRESETS,
  type ScanTarget,
} from '@/lib/security-scans'
import { triggerConfiguredScan } from '@/lib/server/repositories'

export function ScanDialog({
  repositoryId,
  open,
  onOpenChange,
  onStarted,
}: {
  readonly repositoryId: number
  readonly open: boolean
  readonly onOpenChange: (open: boolean) => void
  readonly onStarted: () => Promise<void>
}) {
  const [maxInputTokens, setMaxInputTokens] = useState(
    String(DEFAULT_SCAN_INPUT_TOKEN_BUDGET),
  )
  const [scope, setScope] = useState<'repository' | 'paths'>('repository')
  const [pathText, setPathText] = useState('')
  const [maxCost, setMaxCost] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const start = async () => {
    const paths = pathText
      .split(/[\n,]/)
      .map((path) => path.trim())
      .filter(Boolean)
    if (scope === 'paths' && paths.length === 0) {
      toast.error('Add at least one repository-relative path.')
      return
    }
    const parsedCost = maxCost.trim() ? Number(maxCost) : null
    const parsedMaxInputTokens = Number(maxInputTokens)
    if (
      !Number.isInteger(parsedMaxInputTokens) ||
      parsedMaxInputTokens < 10_000 ||
      parsedMaxInputTokens > MAX_SCAN_INPUT_TOKEN_BUDGET
    ) {
      toast.error(
        `The token budget must be between 10,000 and ${MAX_SCAN_INPUT_TOKEN_BUDGET.toLocaleString()}.`,
      )
      return
    }
    if (
      parsedCost !== null &&
      (!Number.isFinite(parsedCost) || parsedCost <= 0)
    ) {
      toast.error('The cost limit must be a positive number.')
      return
    }
    const target: ScanTarget =
      scope === 'paths' ? { kind: 'paths', paths } : { kind: 'repository' }

    setSubmitting(true)
    try {
      await triggerConfiguredScan({
        data: {
          repositoryId,
          target,
          maxInputTokens: parsedMaxInputTokens,
          maxCostUsd: parsedCost,
        },
      })
      toast.success('Scan started')
      onOpenChange(false)
      await onStarted()
    } catch (error) {
      toast.error(getErrorMessage(error, 'Could not start the scan'))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Start security review</DialogTitle>
          <DialogDescription>
            Set the effort available to this bounded investigation. Each scanner
            discovers its own focus from the repository structure, searches,
            existing findings, and code intelligence.
          </DialogDescription>
        </DialogHeader>

        <DialogBody className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="scan-max-input-tokens">
              Investigation budget (input tokens) *
            </Label>
            <div className="flex flex-wrap gap-2">
              {SCAN_INPUT_TOKEN_BUDGET_PRESETS.map((value) => (
                <Button
                  key={value}
                  type="button"
                  size="sm"
                  variant={
                    maxInputTokens === String(value) ? 'default' : 'outline'
                  }
                  onClick={() => setMaxInputTokens(String(value))}
                >
                  {value.toLocaleString()}
                </Button>
              ))}
            </div>
            <Input
              id="scan-max-input-tokens"
              required
              type="number"
              min={10_000}
              max={MAX_SCAN_INPUT_TOKEN_BUDGET}
              step={1}
              value={maxInputTokens}
              onChange={(event) => setMaxInputTokens(event.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              This budget is divided across the enabled model-backed scanners.
              File count is not used as a proxy for investigation depth.
            </p>
          </div>

          <fieldset className="space-y-2">
            <legend className="text-sm font-semibold">Target</legend>
            <div className="flex flex-wrap gap-4 text-sm">
              <label className="flex items-center gap-2">
                <input
                  type="radio"
                  name="scan-scope"
                  checked={scope === 'repository'}
                  onChange={() => setScope('repository')}
                />
                Entire repository
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="radio"
                  name="scan-scope"
                  checked={scope === 'paths'}
                  onChange={() => setScope('paths')}
                />
                Selected paths
              </label>
            </div>
            {scope === 'paths' ? (
              <div className="space-y-1.5">
                <Label htmlFor="scan-paths">Paths</Label>
                <textarea
                  id="scan-paths"
                  value={pathText}
                  onChange={(event) => setPathText(event.target.value)}
                  placeholder={'src/auth\nsrc/routes/api'}
                  rows={4}
                  className="w-full rounded-xl border border-input bg-card px-3 py-2 text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/45"
                />
                <p className="text-xs text-muted-foreground">
                  One repository-relative file or directory per line.
                </p>
              </div>
            ) : null}
          </fieldset>

          <div className="space-y-1.5">
            <Label htmlFor="scan-max-cost">
              Estimated cost limit (optional)
            </Label>
            <Input
              id="scan-max-cost"
              type="number"
              min="0.01"
              step="0.01"
              value={maxCost}
              onChange={(event) => setMaxCost(event.target.value)}
              placeholder="Use deployment default"
            />
            <p className="text-xs text-muted-foreground">
              The scan is marked partial if final recorded usage exceeds this
              limit. The deployment-wide daily cap still applies.
            </p>
          </div>
        </DialogBody>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={submitting}
          >
            Cancel
          </Button>
          <Button onClick={() => void start()} disabled={submitting}>
            {submitting ? 'Starting…' : 'Start scan'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
