import { useRouter } from '@tanstack/react-router'
import { useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { getErrorMessage } from '@/lib/error-message'
import { formatDateTime } from '@/lib/format'
import {
  CRON_PRESETS,
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

export function ScheduleSettingsForm({
  settings,
}: {
  readonly settings: ScheduleSettings
}) {
  const router = useRouter()
  const [cronExpression, setCronExpression] = useState(settings.cronExpression)
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
  const [submitting, setSubmitting] = useState(false)

  const cronValid = isValidCronExpression(cronExpression)
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
  const nextRun = cronValid
    ? computeNextScanAt(cronExpression, new Date())
    : null

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (
      !cronValid ||
      !cooldownValid ||
      !tokenBudgetValid ||
      !dailyCostBudgetValid ||
      !defaultScanCostValid
    )
      return
    setSubmitting(true)
    try {
      await updateScheduleSettings({
        data: {
          cronExpression: cronExpression.trim(),
          enabled,
          cooldownMinutes: cooldown,
          maxInputTokens: tokenBudget,
          maxDailyCostUsd: dailyCostBudget,
          defaultScanCostUsd: defaultScanCost,
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
          <CardTitle>Repository scan schedule</CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="flex items-center justify-between gap-4 rounded-xl bg-secondary px-4 py-3">
            <div>
              <Label htmlFor="schedule-enabled">Scheduled scans enabled</Label>
              <p className="mt-1 text-xs text-muted-foreground">
                Each run adds repositories without a custom schedule to one
                queue. Repository overrides use their own cron while this is
                enabled.
              </p>
            </div>
            <Switch
              id="schedule-enabled"
              checked={enabled}
              onCheckedChange={setEnabled}
            />
          </div>

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
              className={cn('font-mono', !cronValid && 'border-destructive')}
              value={cronExpression}
              onChange={(event) => setCronExpression(event.target.value)}
            />
            <p
              id="cron-help"
              className={cn(
                'text-xs',
                cronValid ? 'text-muted-foreground' : 'text-destructive-text',
              )}
            >
              {cronValid
                ? `Five fields: minute hour day-of-month month day-of-week. Next run after saving: ${formatDateTime(nextRun)}.`
                : 'Enter a valid 5-field cron expression, e.g. 0 3 * * *'}
            </p>
          </div>

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
            submitting
          }
        >
          {submitting ? 'Saving…' : 'Save settings'}
        </Button>
      </div>
    </form>
  )
}
