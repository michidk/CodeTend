import { createFileRoute, Link, useRouter } from '@tanstack/react-router'
import {
  ArrowDown,
  ArrowUp,
  CalendarClock,
  GripVertical,
  RefreshCw,
} from 'lucide-react'
import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import { Page, PageHeader, SectionHeading } from '@/components/page-layout'
import { RouteError } from '@/components/route-error'
import { ListPending } from '@/components/route-pending'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { getErrorMessage } from '@/lib/error-message'
import { formatDateTime } from '@/lib/format'
import {
  applySchedulePositions,
  getScheduleMovePosition,
} from '@/lib/schedule-order'
import {
  getScheduleQueue,
  saveScheduleQueue,
} from '@/lib/server/schedule-queue'
import { cn } from '@/lib/utils'

export const Route = createFileRoute('/schedule/')({
  loader: () => getScheduleQueue(),
  component: SchedulePage,
  pendingComponent: ListPending,
  errorComponent: ({ error }) => <RouteError error={error} />,
})

function SchedulePage() {
  const { automatic, custom, active, settings } = Route.useLoaderData()
  const router = useRouter()
  const [changes, setChanges] = useState<Map<number, number | null>>(new Map())
  const [dragging, setDragging] = useState<number | null>(null)
  const [saving, setSaving] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [announcement, setAnnouncement] = useState('')
  const rows = useMemo(
    () =>
      applySchedulePositions(
        automatic.map((row) => ({
          ...row,
          position: changes.has(row.id)
            ? (changes.get(row.id) ?? null)
            : row.position,
        })),
      ),
    [automatic, changes],
  )

  const move = (id: number, position: number) => {
    const row = rows.find((entry) => entry.id === id)
    if (!row) return
    try {
      const baseline = automatic.map((entry) => ({
        ...entry,
        position: changes.has(entry.id)
          ? (changes.get(entry.id) ?? null)
          : entry.position,
      }))
      const rank = getScheduleMovePosition(baseline, id, position)
      setChanges((current) => new Map(current).set(id, rank))
    } catch (error) {
      toast.error(getErrorMessage(error, 'Could not move repository'))
      return
    }
    setAnnouncement(
      `${row.name} moved to position ${position + 1}. Save changes to apply.`,
    )
  }
  const reset = (id: number) => {
    setChanges((current) => {
      const next = new Map(current)
      const original = automatic.find((row) => row.id === id)
      if (original?.position === null) next.delete(id)
      else next.set(id, null)
      return next
    })
  }
  const save = async () => {
    setSaving(true)
    try {
      await saveScheduleQueue({
        data: {
          changes: [...changes].map(([id, position]) => {
            const row = automatic.find((entry) => entry.id === id)
            if (!row)
              throw new Error('The schedule changed. Refresh before saving.')
            return {
              repositoryId: id,
              position,
              expectedPosition: row.position,
              expectedUpdatedAt: row.positionUpdatedAt?.toISOString() ?? null,
              lastScanAt: row.lastScanAt?.toISOString() ?? null,
            }
          }),
        },
      })
      await router.invalidate({ sync: true })
      setChanges(new Map())
      toast.success('Schedule changes saved')
    } catch (error) {
      toast.error(getErrorMessage(error, 'Could not save schedule changes'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Page>
      <PageHeader
        title="Schedule"
        description="Arrange the next scans. Repositories you leave untouched stay in the automatic rotation."
        actions={
          <Button asChild variant="outline">
            <Link to="/settings">
              <CalendarClock className="size-4" aria-hidden="true" />
              Schedule settings
            </Link>
          </Button>
        }
      />
      <Card>
        <CardContent className="flex flex-wrap items-center justify-between gap-4 py-5">
          <div>
            <p className="font-display font-bold">
              {settings.enabled
                ? 'Scheduled scans enabled'
                : 'Scheduled scans paused'}
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              {settings.mode === 'distributed'
                ? `${settings.scansPerDay} scans per day`
                : `Cron: ${settings.cronExpression} UTC`}
              {' · '}Next slot:{' '}
              {settings.enabled ? formatDateTime(settings.nextRunAt) : 'Paused'}
              {' · '}
              {settings.cooldownMinutes} minute cooldown
            </p>
          </div>
          <Button
            variant="outline"
            disabled={saving || refreshing || changes.size > 0}
            onClick={async () => {
              setRefreshing(true)
              try {
                await router.invalidate({ sync: true })
              } catch (error) {
                toast.error(
                  getErrorMessage(error, 'Could not refresh the schedule'),
                )
              } finally {
                setRefreshing(false)
              }
            }}
          >
            <RefreshCw
              className={cn('size-4', refreshing && 'animate-spin')}
              aria-hidden="true"
            />
            Refresh
          </Button>
        </CardContent>
      </Card>
      <section aria-labelledby="upcoming-heading" className="mt-8 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <SectionHeading id="upcoming-heading" color="bg-primary">
            Upcoming rotation
          </SectionHeading>
          <div className="flex gap-2">
            <Button
              variant="outline"
              disabled={saving || changes.size === 0}
              onClick={() => setChanges(new Map())}
            >
              Discard changes
            </Button>
            <Button
              disabled={saving || changes.size === 0}
              onClick={() => void save()}
            >
              {saving
                ? 'Saving…'
                : changes.size
                  ? `Save ${changes.size} ${changes.size === 1 ? 'change' : 'changes'}`
                  : 'Save changes'}
            </Button>
          </div>
        </div>
        <p className="max-w-3xl text-sm text-muted-foreground">
          Drag a row or use its arrow buttons to change its next position. Only
          moved repositories are saved. Manual positions clear when that
          scheduled scan starts. Timing depends on available capacity, budget
          and cooldown.
        </p>
        <p className="sr-only" role="status" aria-live="polite">
          {announcement}
        </p>
        {rows.length === 0 ? (
          <Card>
            <CardContent className="py-8 text-center text-muted-foreground">
              No repositories in the automatic rotation. Enable scheduled scans
              on a repository to include it.
            </CardContent>
          </Card>
        ) : (
          <ol
            aria-label="Upcoming scheduled repositories"
            className="space-y-2"
          >
            {rows.map((row, index) => (
              <li
                key={row.id}
                draggable={!saving}
                onDragStart={(event) => {
                  setDragging(row.id)
                  event.dataTransfer.effectAllowed = 'move'
                  event.dataTransfer.setData('text/plain', String(row.id))
                }}
                onDragEnd={() => setDragging(null)}
                onDragOver={(event) => {
                  if (dragging !== null && !saving) {
                    event.preventDefault()
                    event.dataTransfer.dropEffect = 'move'
                  }
                }}
                onDrop={(event) => {
                  event.preventDefault()
                  if (dragging !== null && dragging !== row.id && !saving)
                    move(dragging, index)
                  setDragging(null)
                }}
                className={cn(
                  'flex flex-wrap items-center gap-3 rounded-xl border border-border bg-card px-3 py-4 sm:px-5',
                  dragging === row.id && 'opacity-50',
                  changes.has(row.id) && 'border-primary',
                )}
              >
                <GripVertical
                  className="size-4 shrink-0 text-muted-foreground"
                  aria-hidden="true"
                />
                <span className="w-6 text-center font-display font-bold text-muted-foreground">
                  {index + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <Link
                    to="/repositories/$repositoryId"
                    params={{ repositoryId: String(row.id) }}
                    className="block truncate font-display font-bold hover:underline"
                  >
                    {row.name}
                  </Link>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {row.hasRating ? 'Last attempt' : 'Unrated · Last attempt'}:{' '}
                    {row.lastScanAt
                      ? formatDateTime(row.lastScanAt)
                      : 'Never scanned'}
                    {row.queued ? ' · Queued' : ''}
                  </p>
                </div>
                <span
                  className={cn(
                    'rounded-full px-3 py-1 text-xs font-semibold',
                    row.position === null
                      ? 'bg-secondary text-muted-foreground'
                      : 'bg-primary/15 text-primary',
                  )}
                >
                  {changes.has(row.id)
                    ? 'Unsaved'
                    : row.position === null
                      ? 'Automatic'
                      : 'Manual next scan'}
                </span>
                {row.position !== null && (
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={saving}
                    onClick={() => reset(row.id)}
                  >
                    Reset to automatic
                  </Button>
                )}
                <div className="flex gap-1">
                  <Button
                    size="icon"
                    variant="outline"
                    aria-label={`Move ${row.name} up`}
                    disabled={saving || index === 0}
                    onClick={() => move(row.id, index - 1)}
                  >
                    <ArrowUp className="size-4" aria-hidden="true" />
                  </Button>
                  <Button
                    size="icon"
                    variant="outline"
                    aria-label={`Move ${row.name} down`}
                    disabled={saving || index === rows.length - 1}
                    onClick={() => move(row.id, index + 1)}
                  >
                    <ArrowDown className="size-4" aria-hidden="true" />
                  </Button>
                </div>
              </li>
            ))}
          </ol>
        )}
      </section>
      {(custom.length > 0 || active.length > 0) && (
        <section aria-labelledby="other-heading" className="mt-8 space-y-4">
          <SectionHeading id="other-heading" color="bg-candy-lime">
            Other scheduled repositories
          </SectionHeading>
          <p className="text-sm text-muted-foreground">
            Custom cron schedules keep their due times. Running scans cannot be
            reordered.
          </p>
          <Card>
            <CardContent className="divide-y divide-border py-0">
              {[...active, ...custom].map((row) => (
                <div
                  key={row.id}
                  className="flex flex-wrap justify-between gap-2 py-4"
                >
                  <Link
                    to="/repositories/$repositoryId"
                    params={{ repositoryId: String(row.id) }}
                    className="font-semibold hover:underline"
                  >
                    {row.name}
                  </Link>
                  <span className="text-sm text-muted-foreground">
                    {row.active
                      ? 'Scan queued or running'
                      : row.queued
                        ? 'Due · Queued'
                        : `Next: ${formatDateTime(row.nextScheduledScanAt)}`}
                  </span>
                </div>
              ))}
            </CardContent>
          </Card>
        </section>
      )}
    </Page>
  )
}
