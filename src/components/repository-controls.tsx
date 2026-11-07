import { useRouter } from '@tanstack/react-router'
import { Archive, ArchiveRestore } from 'lucide-react'
import { useId, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { getErrorMessage } from '@/lib/error-message'
import { setRepositoryAutomation } from '@/lib/server/repositories'

export function RepositoryControls({
  repository,
}: {
  readonly repository: {
    id: number
    name: string
    archived: boolean
    scheduleEnabled: boolean
  }
}) {
  const router = useRouter()
  const switchId = useId()
  const [saving, setSaving] = useState(false)
  const update = async (
    action: 'archive' | 'restore' | 'schedule',
    enabled = false,
  ) => {
    setSaving(true)
    try {
      await setRepositoryAutomation({
        data:
          action === 'schedule'
            ? { id: repository.id, action, enabled }
            : { id: repository.id, action },
      })
      toast.success(
        action === 'archive'
          ? 'Repository archived'
          : action === 'restore'
            ? 'Repository restored. Automatic scanning is off.'
            : `Automatic scanning ${enabled ? 'enabled' : 'disabled'}`,
      )
      await router.invalidate()
    } catch (error) {
      toast.error(getErrorMessage(error, 'Could not update the repository'))
    } finally {
      setSaving(false)
    }
  }
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex items-center gap-2">
        <Switch
          id={switchId}
          checked={repository.scheduleEnabled}
          disabled={saving || repository.archived}
          aria-label={`Automatic scanning for ${repository.name}`}
          onCheckedChange={(enabled) => void update('schedule', enabled)}
        />
        <label htmlFor={switchId} className="text-sm">
          Automatic scanning
        </label>
      </div>
      <Button
        size="sm"
        variant="outline"
        disabled={saving}
        onClick={() => void update(repository.archived ? 'restore' : 'archive')}
      >
        {repository.archived ? (
          <ArchiveRestore className="size-4" aria-hidden="true" />
        ) : (
          <Archive className="size-4" aria-hidden="true" />
        )}
        {repository.archived ? 'Restore' : 'Archive'}
      </Button>
    </div>
  )
}
