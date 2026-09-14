import { useNavigate } from '@tanstack/react-router'
import { useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { getErrorMessage } from '@/lib/error-message'
import type { RepositoryInput } from '@/lib/server/repositories'

export interface RepositoryFormProps {
  readonly initialValues?: Partial<RepositoryInput>
  readonly submitLabel: string
  readonly onSubmit: (values: RepositoryInput) => Promise<{ id: number }>
  readonly onCancel?: () => void
}

const DEFAULTS: RepositoryInput = {
  name: '',
  url: '',
  branch: 'main',
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
}: RepositoryFormProps) {
  const navigate = useNavigate()
  const [values, setValues] = useState<RepositoryInput>({
    ...DEFAULTS,
    ...initialValues,
  })
  const [nameTouched, setNameTouched] = useState(Boolean(initialValues?.name))
  const [submitting, setSubmitting] = useState(false)

  const canSubmit =
    values.name.trim() && values.url.trim() && values.branch.trim()

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
