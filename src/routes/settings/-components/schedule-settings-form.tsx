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
  MAX_SCAN_FILE_GLOB_LENGTH,
  MAX_SCAN_MAX_FILES,
  SCAN_FILE_BUDGET_PRESETS,
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
  const [maxFiles, setMaxFiles] = useState(String(settings.maxFiles))
  const [fileGlob, setFileGlob] = useState(settings.fileGlob)
  const [submitting, setSubmitting] = useState(false)

  const cronValid = isValidCronExpression(cronExpression)
  const cooldown = Number(cooldownMinutes)
  const cooldownValid =
    Number.isInteger(cooldown) && cooldown >= 0 && cooldown <= 10_080
  const fileBudget = Number(maxFiles)
  const fileBudgetValid =
    Number.isInteger(fileBudget) &&
    fileBudget >= 1 &&
    fileBudget <= MAX_SCAN_MAX_FILES
  const fileGlobValid =
    fileGlob.trim().length > 0 &&
    fileGlob.trim().length <= MAX_SCAN_FILE_GLOB_LENGTH
  const nextRun = cronValid
    ? computeNextScanAt(cronExpression, new Date())
    : null

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!cronValid || !cooldownValid || !fileBudgetValid || !fileGlobValid)
      return
    setSubmitting(true)
    try {
      await updateScheduleSettings({
        data: {
          cronExpression: cronExpression.trim(),
          enabled,
          cooldownMinutes: cooldown,
          maxFiles: fileBudget,
          fileGlob: fileGlob.trim(),
        },
      })
      toast.success('Schedule settings saved')
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
                Each run adds every registered repository to one queue.
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
            <Label htmlFor="schedule-max-files">
              Review budget per repository (files) *
            </Label>
            <div className="flex flex-wrap gap-2">
              {SCAN_FILE_BUDGET_PRESETS.map((value) => (
                <Button
                  key={value}
                  type="button"
                  size="sm"
                  variant={maxFiles === String(value) ? 'default' : 'outline'}
                  onClick={() => setMaxFiles(String(value))}
                >
                  {value.toLocaleString()}
                </Button>
              ))}
            </div>
            <Input
              id="schedule-max-files"
              required
              type="number"
              min={1}
              max={MAX_SCAN_MAX_FILES}
              step={1}
              aria-invalid={!fileBudgetValid}
              value={maxFiles}
              onChange={(event) => setMaxFiles(event.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              Every queued repository uses this maximum file sample. CodeTend
              applies the file glob first, prioritizes high-signal matches, and
              marks larger matching targets as partial coverage.
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="scan-file-glob">Review file glob *</Label>
            <Input
              id="scan-file-glob"
              required
              className="font-mono"
              maxLength={MAX_SCAN_FILE_GLOB_LENGTH}
              aria-invalid={!fileGlobValid}
              value={fileGlob}
              onChange={(event) => setFileGlob(event.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              Applied before the file budget for manual and scheduled scans. Use
              a standard glob such as <code>{'**/*.{ts,tsx,js,jsx}'}</code>.
              Dependency manifests are still handled separately by the
              dependency audit.
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

      <div className="flex justify-end">
        <Button
          type="submit"
          disabled={
            !cronValid ||
            !cooldownValid ||
            !fileBudgetValid ||
            !fileGlobValid ||
            submitting
          }
        >
          {submitting ? 'Saving…' : 'Save settings'}
        </Button>
      </div>
    </form>
  )
}
