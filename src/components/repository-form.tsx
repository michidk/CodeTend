import { useNavigate } from '@tanstack/react-router'
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
import type { RepositoryInput } from '@/lib/server/repositories'
import { cn } from '@/lib/utils'

export interface RepositoryFormProps {
  readonly initialValues?: Partial<RepositoryInput>
  readonly submitLabel: string
  readonly onSubmit: (values: RepositoryInput) => Promise<{ id: number }>
  readonly onCancel?: () => void
  readonly globalSchedule: {
    enabled: boolean
    cronExpression: string
    nextRunAt: Date | null
  }
}

const DEFAULTS: RepositoryInput = {
  name: '',
  url: '',
  branch: 'main',
  scheduleEnabled: true,
  scheduleCronExpression: null,
}

function suggestName(url: string): string {
  const cleaned = url
    .trim()
    .replace(/\.git$/, '')
    .replace(/\/+$/, '')
  const segments = cleaned.split(/[/:]/).filter(Boolean)
  return segments.slice(-2).join('/') || ''
}

export function RepositoryForm({
  initialValues,
  submitLabel,
  onSubmit,
  onCancel,
  globalSchedule,
}: RepositoryFormProps) {
  const navigate = useNavigate()
  const [values, setValues] = useState<RepositoryInput>({
    ...DEFAULTS,
    ...initialValues,
  })
  const [nameTouched, setNameTouched] = useState(Boolean(initialValues?.name))
  const [submitting, setSubmitting] = useState(false)

  const customCronValid =
    !values.scheduleEnabled ||
    values.scheduleCronExpression === null ||
    isValidCronExpression(values.scheduleCronExpression)
  const canSubmit =
    values.name.trim() &&
    values.url.trim() &&
    values.branch.trim() &&
    customCronValid
  const customNextRun =
    values.scheduleCronExpression && customCronValid
      ? computeNextScanAt(values.scheduleCronExpression, new Date())
      : null

  const update = <Key extends keyof RepositoryInput>(
    key: Key,
    value: RepositoryInput[Key],
  ) => setValues((current) => ({ ...current, [key]: value }))

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!canSubmit) return
    setSubmitting(true)
    try {
      const saved = await onSubmit({
        ...values,
        name: values.name.trim(),
        url: values.url.trim(),
        branch: values.branch.trim(),
        scheduleCronExpression: values.scheduleEnabled
          ? (values.scheduleCronExpression?.trim() ?? null)
          : null,
      })
      toast.success('Repository saved')
      await navigate({
        to: '/repositories/$repositoryId',
        params: { repositoryId: String(saved.id) },
      })
    } catch (error) {
      toast.error(getErrorMessage(error, 'Could not save the repository'))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form
      onSubmit={(event) => void handleSubmit(event)}
      className="space-y-5 sm:space-y-6"
    >
      <Card>
        <CardHeader>
          <CardTitle>Repository</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="url">Git URL *</Label>
            <Input
              id="url"
              required
              autoComplete="off"
              placeholder="https://github.com/owner/repo.git"
              value={values.url}
              onChange={(event) => {
                update('url', event.target.value)
                if (!nameTouched)
                  update('name', suggestName(event.target.value))
              }}
            />
            <p className="text-xs text-muted-foreground">
              Anything <code>git clone</code> accepts from the app host. Private
              repositories need GitHub credentials or host Git configuration.
            </p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="name">Display name *</Label>
              <Input
                id="name"
                required
                value={values.name}
                onChange={(event) => {
                  setNameTouched(true)
                  update('name', event.target.value)
                }}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="branch">Branch *</Label>
              <Input
                id="branch"
                required
                value={values.branch}
                onChange={(event) => update('branch', event.target.value)}
              />
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Scan schedule</CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="flex items-center justify-between gap-4 rounded-xl bg-secondary px-4 py-3">
            <div>
              <Label htmlFor="repository-schedule-enabled">
                Scheduled scans enabled
              </Label>
              <p className="mt-1 text-xs text-muted-foreground">
                Turn this off to run this repository only when scanned manually.
              </p>
            </div>
            <Switch
              id="repository-schedule-enabled"
              checked={values.scheduleEnabled}
              onCheckedChange={(checked) =>
                setValues((current) => ({
                  ...current,
                  scheduleEnabled: checked,
                  scheduleCronExpression: checked
                    ? current.scheduleCronExpression
                    : null,
                }))
              }
            />
          </div>

          {values.scheduleEnabled ? (
            <>
              <div className="flex items-center justify-between gap-4 rounded-xl border border-border px-4 py-3">
                <div>
                  <Label htmlFor="custom-schedule">
                    Override global schedule
                  </Label>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {globalSchedule.enabled
                      ? `Default: ${globalSchedule.cronExpression} (UTC), next ${formatDateTime(globalSchedule.nextRunAt)}.`
                      : 'Scheduled scans are globally disabled.'}
                  </p>
                </div>
                <Switch
                  id="custom-schedule"
                  checked={values.scheduleCronExpression !== null}
                  onCheckedChange={(checked) =>
                    update(
                      'scheduleCronExpression',
                      checked ? globalSchedule.cronExpression : null,
                    )
                  }
                />
              </div>

              {values.scheduleCronExpression !== null ? (
                <>
                  <div className="flex flex-wrap gap-2">
                    {CRON_PRESETS.map((preset) => (
                      <Button
                        key={preset.value}
                        type="button"
                        size="sm"
                        variant={
                          values.scheduleCronExpression === preset.value
                            ? 'default'
                            : 'outline'
                        }
                        onClick={() =>
                          update('scheduleCronExpression', preset.value)
                        }
                      >
                        {preset.label}
                      </Button>
                    ))}
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="repository-cron">
                      Cron expression (UTC) *
                    </Label>
                    <Input
                      id="repository-cron"
                      required
                      aria-invalid={!customCronValid}
                      aria-describedby="repository-cron-help"
                      className={cn(
                        'font-mono',
                        !customCronValid && 'border-destructive',
                      )}
                      value={values.scheduleCronExpression}
                      onChange={(event) =>
                        update('scheduleCronExpression', event.target.value)
                      }
                    />
                    <p
                      id="repository-cron-help"
                      className={cn(
                        'text-xs',
                        customCronValid
                          ? 'text-muted-foreground'
                          : 'text-destructive-text',
                      )}
                    >
                      {customCronValid
                        ? `Five fields: minute hour day-of-month month day-of-week. Next run after saving: ${formatDateTime(customNextRun)}.`
                        : 'Enter a valid 5-field cron expression, e.g. 0 3 * * 1 for Mondays at 03:00.'}
                    </p>
                  </div>
                </>
              ) : null}
            </>
          ) : (
            <p className="text-sm text-muted-foreground">
              Scheduled runs are disabled for this repository. Manual scans are
              still available.
            </p>
          )}
        </CardContent>
      </Card>

      <div className="flex justify-end gap-2">
        <Button
          type="button"
          variant="outline"
          onClick={() => (onCancel ? onCancel() : void navigate({ to: '/' }))}
        >
          Cancel
        </Button>
        <Button type="submit" disabled={!canSubmit || submitting}>
          {submitting ? 'Saving…' : submitLabel}
        </Button>
      </div>
    </form>
  )
}
