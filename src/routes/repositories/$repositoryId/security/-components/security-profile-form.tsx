import { useRouter } from '@tanstack/react-router'
import { useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { getErrorMessage } from '@/lib/error-message'
import type { SecurityProfile } from '@/lib/security-scans'
import { updateRepositorySecurityProfile } from '@/lib/server/security-profile'

const LIST_FIELDS = [
  ['assets', 'Assets'],
  ['entryPoints', 'Entry points and untrusted inputs'],
  ['trustBoundaries', 'Trust boundaries'],
  ['authAssumptions', 'Authentication and authorization assumptions'],
  ['sensitiveDataPaths', 'Sensitive data paths'],
  ['privilegedActions', 'Privileged actions'],
  ['securityInvariants', 'Security invariants'],
  ['priorities', 'Review priorities'],
  ['exclusions', 'Explicit exclusions'],
] as const satisfies readonly [
  Exclude<keyof SecurityProfile, 'projectOverview'>,
  string,
][]

export function SecurityProfileForm({
  repositoryId,
  initial,
}: {
  repositoryId: number
  initial: SecurityProfile
}) {
  const router = useRouter()
  const [profile, setProfile] = useState(initial)
  const [saving, setSaving] = useState(false)

  const save = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setSaving(true)
    try {
      await updateRepositorySecurityProfile({
        data: { repositoryId, profile },
      })
      toast.success('Security profile saved')
      await router.invalidate()
    } catch (error) {
      toast.error(getErrorMessage(error, 'Could not save the security profile'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={(event) => void save(event)} className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Project overview</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <Label htmlFor="security-project-overview">
            Architecture and security context
          </Label>
          <textarea
            id="security-project-overview"
            value={profile.projectOverview}
            onChange={(event) =>
              setProfile((current) => ({
                ...current,
                projectOverview: event.target.value,
              }))
            }
            rows={10}
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        {LIST_FIELDS.map(([field, label]) => (
          <Card key={field}>
            <CardHeader>
              <CardTitle>{label}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <Label htmlFor={`security-${field}`}>One item per line</Label>
              <textarea
                id={`security-${field}`}
                value={profile[field].join('\n')}
                onChange={(event) =>
                  setProfile((current) => ({
                    ...current,
                    [field]: event.target.value
                      .split('\n')
                      .map((value) => value.trim())
                      .filter(Boolean),
                  }))
                }
                rows={6}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="flex justify-end">
        <Button type="submit" disabled={saving}>
          {saving ? 'Saving…' : 'Save security profile'}
        </Button>
      </div>
    </form>
  )
}
