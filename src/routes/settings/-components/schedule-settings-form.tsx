import { useRouter } from '@tanstack/react-router'
import { useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { REASONING_EFFORTS } from '@/lib/agent-execution'
import { getErrorMessage } from '@/lib/error-message'
import { formatDateTime } from '@/lib/format'
import {
  CRON_PRESETS,
  computeNextDistributedScanAt,
  computeNextScanAt,
  isValidCronExpression,
} from '@/lib/schedule'
import {
  MAX_SCAN_INPUT_TOKEN_BUDGET,
  SCAN_INPUT_TOKEN_BUDGET_PRESETS,
} from '@/lib/security-scans'
import type { getScheduleSettings } from '@/lib/server/schedule-settings'
import { updateScheduleSettings } from '@/lib/server/schedule-settings'
import { cn } from '@/lib/utils'

type ScheduleSettings = Awaited<ReturnType<typeof getScheduleSettings>>

function formatDistributedInterval(scansPerDay: number): string {
  const minutes = Math.round(1_440 / scansPerDay)
  if (minutes >= 60) {
    const hours = Math.floor(minutes / 60)
    const remainder = minutes % 60
    return remainder === 0
      ? `${hours} ${hours === 1 ? 'hour' : 'hours'}`
      : `${hours}h ${remainder}m`
  }
  return `${minutes} ${minutes === 1 ? 'minute' : 'minutes'}`
}

export function ScheduleSettingsForm({
  settings,
}: {
  readonly settings: ScheduleSettings
}) {
  const router = useRouter()
  const [mode, setMode] = useState(settings.mode)
  const [cronExpression, setCronExpression] = useState(settings.cronExpression)
  const [scansPerDay, setScansPerDay] = useState(String(settings.scansPerDay))
  const [enabled, setEnabled] = useState(settings.enabled)
  const [cooldownMinutes, setCooldownMinutes] = useState(
    String(settings.cooldownMinutes),
  )
  const [maxInputTokens, setMaxInputTokens] = useState(
    String(settings.maxInputTokens),
  )
  const [maxDailyCostUsd, setMaxDailyCostUsd] = useState(
    settings.maxDailyCostUsd === null ? '' : String(settings.maxDailyCostUsd),
  )
  const [defaultScanCostUsd, setDefaultScanCostUsd] = useState(
    settings.defaultScanCostUsd === null
      ? ''
      : String(settings.defaultScanCostUsd),
  )
  const [scanConcurrency, setScanConcurrency] = useState(
    String(settings.scanConcurrency),
  )
  const [fixConcurrency, setFixConcurrency] = useState(
    String(settings.fixConcurrency),
  )
  const [scanModel, setScanModel] = useState(settings.scanModel)
  const [scanEffort, setScanEffort] = useState(settings.scanEffort)
  const [fixModel, setFixModel] = useState(settings.fixModel)
  const [fixEffort, setFixEffort] = useState(settings.fixEffort)
  const [submitting, setSubmitting] = useState(false)

  const cronValid =
    mode === 'distributed' || isValidCronExpression(cronExpression)
  const dailyScanCount = Number(scansPerDay)
  const scansPerDayValid =
    Number.isInteger(dailyScanCount) &&
    dailyScanCount >= 1 &&
    dailyScanCount <= 1_440
  const cooldown = Number(cooldownMinutes)
  const cooldownValid =
    Number.isInteger(cooldown) && cooldown >= 0 && cooldown <= 10_080
  const tokenBudget = Number(maxInputTokens)
  const tokenBudgetValid =
    Number.isInteger(tokenBudget) &&
    tokenBudget >= 10_000 &&
    tokenBudget <= MAX_SCAN_INPUT_TOKEN_BUDGET
  const dailyCostBudget = maxDailyCostUsd.trim()
    ? Number(maxDailyCostUsd)
    : null
  const dailyCostBudgetValid =
    dailyCostBudget === null ||
    (Number.isFinite(dailyCostBudget) && dailyCostBudget > 0)
  const defaultScanCost = defaultScanCostUsd.trim()
    ? Number(defaultScanCostUsd)
    : null
  const defaultScanCostValid =
    defaultScanCost === null ||
    (Number.isFinite(defaultScanCost) && defaultScanCost > 0)
  const scanConcurrencyValue = Number(scanConcurrency)
  const fixConcurrencyValue = Number(fixConcurrency)
  const concurrencyValid =
    Number.isInteger(scanConcurrencyValue) &&
    scanConcurrencyValue >= 1 &&
    scanConcurrencyValue <= 32 &&
    Number.isInteger(fixConcurrencyValue) &&
    fixConcurrencyValue >= 1 &&
    fixConcurrencyValue <= 32
  const profilesValid = Boolean(scanModel.trim() && fixModel.trim())
  const nextRun =
    cronValid && scansPerDayValid
      ? mode === 'distributed'
        ? computeNextDistributedScanAt(dailyScanCount, new Date())
        : computeNextScanAt(cronExpression, new Date())
      : null

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (
      !cronValid ||
      !scansPerDayValid ||
      !cooldownValid ||
      !tokenBudgetValid ||
      !dailyCostBudgetValid ||
      !defaultScanCostValid ||
      !concurrencyValid ||
      !profilesValid
    )
      return
    setSubmitting(true)
    try {
      await updateScheduleSettings({
        data: {
          mode,
          cronExpression: cronExpression.trim(),
          enabled,
          scansPerDay: dailyScanCount,
          cooldownMinutes: cooldown,
          maxInputTokens: tokenBudget,
          maxDailyCostUsd: dailyCostBudget,
          defaultScanCostUsd: defaultScanCost,
          scanConcurrency: scanConcurrencyValue,
          fixConcurrency: fixConcurrencyValue,
          scanModel: scanModel.trim(),
          scanEffort,
          fixModel: fixModel.trim(),
          fixEffort,
        },
      })
      toast.success('Settings saved')
      await router.invalidate()
    } catch (error) {
      toast.error(getErrorMessage(error, 'Could not save schedule settings'))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form onSubmit={(event) => void submit(event)} className="space-y-5">
      <Card>
        <CardHeader>
          <CardTitle>Agent execution</CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          <p className="text-sm text-muted-foreground">
            Scans and fix agents use independent FIFO queues. Raising a limit
            immediately dispatches queued work up to the new capacity.
          </p>
          <div className="grid gap-5 sm:grid-cols-2">
            <ExecutionProfileFields
              kind="scan"
              title="Scan agents"
              model={scanModel}
              effort={scanEffort}
              concurrency={scanConcurrency}
              queued={settings.queuedScans}
              onModelChange={setScanModel}
              onEffortChange={setScanEffort}
              onConcurrencyChange={setScanConcurrency}
            />
            <ExecutionProfileFields
              kind="fix"
              title="Fix agents"
              model={fixModel}
              effort={fixEffort}
              concurrency={fixConcurrency}
              queued={settings.queuedFixes}
              onModelChange={setFixModel}
              onEffortChange={setFixEffort}
              onConcurrencyChange={setFixConcurrency}
            />
          </div>
          {!concurrencyValid || !profilesValid ? (
            <p className="text-xs text-destructive-text">
              Models are required; concurrency must be between 1 and 32.
            </p>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Repository scan schedule</CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="flex items-center justify-between gap-4 rounded-xl bg-secondary px-4 py-3">
            <div>
              <Label htmlFor="schedule-enabled">Scheduled scans enabled</Label>
              <p className="mt-1 text-xs text-muted-foreground">
                Applies the selected global mode to enabled repositories that
                inherit it. Repository overrides use their own cron while this
                is enabled.
              </p>
            </div>
            <Switch
              id="schedule-enabled"
              checked={enabled}
              onCheckedChange={setEnabled}
            />
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <Button
              type="button"
              variant={mode === 'cron' ? 'default' : 'outline'}
              className="min-h-16 items-start justify-start rounded-xl py-3 text-left whitespace-normal"
              style={{ height: 'auto' }}
              onClick={() => setMode('cron')}
            >
              <span>
                <span className="block">Cron schedule</span>
                <span className="block text-xs font-normal opacity-80">
                  Queue every inherited repository when cron is due.
                </span>
              </span>
            </Button>
            <Button
              type="button"
              variant={mode === 'distributed' ? 'default' : 'outline'}
              className="min-h-16 items-start justify-start rounded-xl py-3 text-left whitespace-normal"
              style={{ height: 'auto' }}
              onClick={() => setMode('distributed')}
            >
              <span>
                <span className="block">Distribute scans</span>
                <span className="block text-xs font-normal opacity-80">
                  Rotate through repositories at a fixed daily rate.
                </span>
              </span>
            </Button>
          </div>

          {mode === 'cron' ? (
            <>
              <div className="flex flex-wrap gap-2">
                {CRON_PRESETS.map((preset) => (
                  <Button
                    key={preset.value}
                    type="button"
                    size="sm"
                    variant={
                      cronExpression === preset.value ? 'default' : 'outline'
                    }
                    onClick={() => setCronExpression(preset.value)}
                  >
                    {preset.label}
                  </Button>
                ))}
              </div>

              <div className="space-y-2">
                <Label htmlFor="cron">Cron expression (UTC) *</Label>
                <Input
                  id="cron"
                  required
                  aria-invalid={!cronValid}
                  aria-describedby="cron-help"
                  className={cn(
                    'font-mono',
                    !cronValid && 'border-destructive',
                  )}
                  value={cronExpression}
                  onChange={(event) => setCronExpression(event.target.value)}
                />
                <p
                  id="cron-help"
                  className={cn(
                    'text-xs',
                    cronValid
                      ? 'text-muted-foreground'
                      : 'text-destructive-text',
                  )}
                >
                  {cronValid
                    ? `Five fields: minute hour day-of-month month day-of-week. Next run after saving: ${formatDateTime(nextRun)}.`
                    : 'Enter a valid 5-field cron expression, e.g. 0 3 * * *'}
                </p>
              </div>
            </>
          ) : (
            <div className="space-y-2">
              <Label htmlFor="scans-per-day">Scans per day *</Label>
              <Input
                id="scans-per-day"
                required
                type="number"
                min={1}
                max={1_440}
                step={1}
                aria-invalid={!scansPerDayValid}
                value={scansPerDay}
                onChange={(event) => setScansPerDay(event.target.value)}
              />
              <p
                className={cn(
                  'text-xs',
                  scansPerDayValid
                    ? 'text-muted-foreground'
                    : 'text-destructive-text',
                )}
              >
                {scansPerDayValid
                  ? `One inherited repository is queued every ${formatDistributedInterval(dailyScanCount)}. Next slot after saving: ${formatDateTime(nextRun)}. Custom cron overrides run separately.`
                  : 'Enter a whole number between 1 and 1,440.'}
              </p>
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="schedule-max-input-tokens">
              Investigation budget per repository (input tokens) *
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
              id="schedule-max-input-tokens"
              required
              type="number"
              min={10_000}
              max={MAX_SCAN_INPUT_TOKEN_BUDGET}
              step={1}
              aria-invalid={!tokenBudgetValid}
              value={maxInputTokens}
              onChange={(event) => setMaxInputTokens(event.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              Shared across scanner-directed investigations. Each scanner
              chooses its own evidence from repository structure, searches,
              files, and dependency-graph results.
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="cooldown">
              Cooldown between repositories (minutes) *
            </Label>
            <Input
              id="cooldown"
              required
              type="number"
              min={0}
              max={10_080}
              step={1}
              aria-invalid={!cooldownValid}
              value={cooldownMinutes}
              onChange={(event) => setCooldownMinutes(event.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              The queue starts at most one new repository scan during this
              period. Use 0 to dispatch on every scheduler tick.
            </p>
          </div>

          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 border-t border-border/70 pt-4 text-sm">
            <dt className="text-muted-foreground">Currently queued</dt>
            <dd className="text-right tabular-nums">
              {settings.queuedRepositories}
            </dd>
            <dt className="text-muted-foreground">Next scheduled run</dt>
            <dd className="text-right tabular-nums">
              {settings.enabled
                ? formatDateTime(settings.nextRunAt)
                : 'Disabled'}
            </dd>
          </dl>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>AI cost controls</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-5 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="max-daily-cost">
              Daily cost limit (USD, optional)
            </Label>
            <Input
              id="max-daily-cost"
              type="number"
              min="0.01"
              step="0.01"
              aria-invalid={!dailyCostBudgetValid}
              value={maxDailyCostUsd}
              onChange={(event) => setMaxDailyCostUsd(event.target.value)}
              placeholder="Unlimited"
            />
            <p className="text-xs text-muted-foreground">
              Stops new scans and patch generation after combined estimated
              spend reaches this amount during a UTC day. Leave blank for no
              limit.
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="default-scan-cost">
              Default scan cost limit (USD, optional)
            </Label>
            <Input
              id="default-scan-cost"
              type="number"
              min="0.01"
              step="0.01"
              aria-invalid={!defaultScanCostValid}
              value={defaultScanCostUsd}
              onChange={(event) => setDefaultScanCostUsd(event.target.value)}
              placeholder="No default"
            />
            <p className="text-xs text-muted-foreground">
              Applies when a scan does not provide its own estimated cost limit.
              Leave blank for no default limit.
            </p>
          </div>
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <Button
          type="submit"
          disabled={
            !cronValid ||
            !cooldownValid ||
            !tokenBudgetValid ||
            !dailyCostBudgetValid ||
            !defaultScanCostValid ||
            !concurrencyValid ||
            !profilesValid ||
            submitting
          }
        >
          {submitting ? 'Saving…' : 'Save settings'}
        </Button>
      </div>
    </form>
  )
}

function ExecutionProfileFields({
  kind,
  title,
  model,
  effort,
  concurrency,
  queued,
  onModelChange,
  onEffortChange,
  onConcurrencyChange,
}: {
  readonly kind: 'scan' | 'fix'
  readonly title: string
  readonly model: string
  readonly effort: (typeof REASONING_EFFORTS)[number]
  readonly concurrency: string
  readonly queued: number
  readonly onModelChange: (value: string) => void
  readonly onEffortChange: (value: (typeof REASONING_EFFORTS)[number]) => void
  readonly onConcurrencyChange: (value: string) => void
}) {
  return (
    <fieldset className="space-y-3 rounded-xl border border-border p-4">
      <legend className="px-1 font-display font-bold">{title}</legend>
      <div className="space-y-2">
        <Label htmlFor={`${kind}-model`}>Default model</Label>
        <Input
          id={`${kind}-model`}
          required
          value={model}
          onChange={(event) => onModelChange(event.target.value)}
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor={`${kind}-effort`}>Reasoning effort</Label>
        <select
          id={`${kind}-effort`}
          className="h-10 w-full rounded-xl border border-input bg-card px-3 text-sm"
          value={effort}
          onChange={(event) =>
            onEffortChange(
              event.target.value as (typeof REASONING_EFFORTS)[number],
            )
          }
        >
          {REASONING_EFFORTS.map((value) => (
            <option key={value} value={value}>
              {value}
            </option>
          ))}
        </select>
      </div>
      <div className="space-y-2">
        <Label htmlFor={`${kind}-concurrency`}>Maximum concurrency</Label>
        <Input
          id={`${kind}-concurrency`}
          required
          type="number"
          min={1}
          max={32}
          step={1}
          value={concurrency}
          onChange={(event) => onConcurrencyChange(event.target.value)}
        />
      </div>
      <p className="text-xs text-muted-foreground">{queued} currently queued</p>
    </fieldset>
  )
}
