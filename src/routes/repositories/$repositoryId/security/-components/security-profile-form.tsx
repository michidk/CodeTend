import { useRouter } from '@tanstack/react-router'
import { Plus, Trash2 } from 'lucide-react'
import { useRef, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardAction,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Textarea } from '@/components/ui/textarea'
import { getErrorMessage } from '@/lib/error-message'
import type { SecurityProfile } from '@/lib/security-scans'
import { updateRepositorySecurityProfile } from '@/lib/server/security-profile'

type ListField = Exclude<keyof SecurityProfile, 'projectOverview'>

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
] as const satisfies readonly [ListField, string][]

function normalizeProfile(profile: SecurityProfile): SecurityProfile {
  return {
    ...profile,
    ...Object.fromEntries(
      LIST_FIELDS.map(([field]) => [
        field,
        profile[field].map((value) => value.trim()).filter(Boolean),
      ]),
    ),
  }
}

export function SecurityProfileForm({
  repositoryId,
  initial,
}: {
  repositoryId: number
  initial: SecurityProfile
}) {
  const router = useRouter()
  const [profile, setProfile] = useState(initial)
  const [rowIds, setRowIds] = useState(
    () =>
      Object.fromEntries(
        LIST_FIELDS.map(([field]) => [
          field,
          initial[field].map((_, index) => `${field}-${index}`),
        ]),
      ) as Record<ListField, string[]>,
  )
  const nextRowId = useRef(0)
  const [saving, setSaving] = useState(false)

  const save = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setSaving(true)
    try {
      const normalizedProfile = normalizeProfile(profile)
      await updateRepositorySecurityProfile({
        data: { repositoryId, profile: normalizedProfile },
      })
      setRowIds(
        (current) =>
          Object.fromEntries(
            LIST_FIELDS.map(([field]) => [
              field,
              current[field].filter((_, index) =>
                profile[field][index]?.trim(),
              ),
            ]),
          ) as Record<ListField, string[]>,
      )
      setProfile(normalizedProfile)
      toast.success('Security context saved')
      await router.invalidate()
    } catch (error) {
      toast.error(getErrorMessage(error, 'Could not save the security context'))
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
          <Textarea
            id="security-project-overview"
            value={profile.projectOverview}
            onChange={(event) =>
              setProfile((current) => ({
                ...current,
                projectOverview: event.target.value,
              }))
            }
            rows={10}
          />
        </CardContent>
      </Card>
      <div className="grid gap-4 lg:grid-cols-2">
        {LIST_FIELDS.map(([field, label]) => (
          <Card key={field}>
            <CardHeader>
              <CardTitle>{label}</CardTitle>
              <CardAction>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={profile[field].length >= 100}
                  onClick={() => {
                    setProfile((current) => ({
                      ...current,
                      [field]: [...current[field], ''],
                    }))
                    setRowIds((current) => ({
                      ...current,
                      [field]: [
                        ...current[field],
                        `${field}-new-${nextRowId.current++}`,
                      ],
                    }))
                  }}
                >
                  <Plus aria-hidden="true" />
                  Add item
                </Button>
              </CardAction>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-12 text-right">#</TableHead>
                    <TableHead>Detail</TableHead>
                    <TableHead className="w-12">
                      <span className="sr-only">Actions</span>
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {profile[field].length === 0 ? (
                    <TableRow>
                      <TableCell
                        colSpan={3}
                        className="h-20 text-center text-muted-foreground"
                      >
                        No items yet.
                      </TableCell>
                    </TableRow>
                  ) : (
                    profile[field].map((value, index) => (
                      <TableRow key={rowIds[field][index]}>
                        <TableCell className="text-right align-top text-muted-foreground tabular-nums">
                          {index + 1}
                        </TableCell>
                        <TableCell className="whitespace-normal">
                          <Label
                            htmlFor={`security-${field}-${index}`}
                            className="sr-only"
                          >
                            {label} item {index + 1}
                          </Label>
                          <Textarea
                            id={`security-${field}-${index}`}
                            value={value}
                            onChange={(event) =>
                              setProfile((current) => ({
                                ...current,
                                [field]: current[field].map(
                                  (item, itemIndex) =>
                                    itemIndex === index
                                      ? event.target.value
                                      : item,
                                ),
                              }))
                            }
                            rows={1}
                            className="max-h-48 min-h-20 resize-none overflow-y-auto [field-sizing:content]"
                          />
                        </TableCell>
                        <TableCell className="align-top">
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon-sm"
                            aria-label={`Remove ${label.toLowerCase()} item ${index + 1}`}
                            onClick={() => {
                              setProfile((current) => ({
                                ...current,
                                [field]: current[field].filter(
                                  (_, itemIndex) => itemIndex !== index,
                                ),
                              }))
                              setRowIds((current) => ({
                                ...current,
                                [field]: current[field].filter(
                                  (_, itemIndex) => itemIndex !== index,
                                ),
                              }))
                            }}
                          >
                            <Trash2 aria-hidden="true" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        ))}
      </div>
      <div className="flex justify-end">
        <Button type="submit" disabled={saving}>
          {saving ? 'Saving…' : 'Save security context'}
        </Button>
      </div>
    </form>
  )
}
