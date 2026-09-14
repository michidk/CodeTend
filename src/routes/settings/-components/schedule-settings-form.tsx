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
  const [submitting, setSubmitting] = useState(false)

  const cronValid = isValidCronExpression(cronExpression)
  const cooldown = Number(cooldownMinutes)
  const cooldownValid =
    Number.isInteger(cooldown) && cooldown >= 0 && cooldown <= 10_080
  const nextRun = cronValid
    ? computeNextScanAt(cronExpression, new Date())
    : null

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!cronValid || !cooldownValid) return
    setSubmitting(true)
    try {
      await updateScheduleSettings({
        data: {
          cronExpression: cronExpression.trim(),
          enabled,
          cooldownMinutes: cooldown,
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
          disabled={!cronValid || !cooldownValid || submitting}
        >
          {submitting ? 'Saving…' : 'Save settings'}
        </Button>
      </div>
    </form>
  )
}
