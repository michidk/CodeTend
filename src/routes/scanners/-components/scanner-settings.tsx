import { useRouter } from '@tanstack/react-router'
import { Plus, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { REASONING_EFFORTS } from '@/lib/agent-execution'
import { getErrorMessage } from '@/lib/error-message'
import { customScannerSchema } from '@/lib/scanner-configuration'
import type { ScannerDefinition } from '@/lib/scanners'
import {
  createCustomScanner,
  deleteCustomScanner,
  setGlobalScannerEnabled,
  setGlobalScannerExecutionProfile,
} from '@/lib/server/scanner-settings'

const EMPTY_FORM = {
  id: '',
  name: '',
  shortName: '',
  description: '',
  weight: '1',
  prompt: '',
  fixPromptTitle: '',
  fixGuidance: '',
}

export function ScannerSettings({
  scanners,
}: {
  readonly scanners: readonly ScannerDefinition[]
}) {
  const router = useRouter()
  const [changingId, setChangingId] = useState<string | null>(null)
  const [createOpen, setCreateOpen] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<ScannerDefinition | null>(
    null,
  )
  const [creating, setCreating] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [form, setForm] = useState(EMPTY_FORM)
  const [profiles, setProfiles] = useState(() =>
    Object.fromEntries(
      scanners.map((scanner) => [
        scanner.id,
        { model: scanner.model ?? '', effort: scanner.effort ?? '' },
      ]),
    ),
  )

  const toggle = async (scanner: ScannerDefinition, enabled: boolean) => {
    setChangingId(scanner.id)
    try {
      await setGlobalScannerEnabled({
        data: { scannerId: scanner.id, enabled },
      })
      toast.success(`${scanner.name} ${enabled ? 'enabled' : 'disabled'}`)
      await router.invalidate()
    } catch (error) {
      toast.error(getErrorMessage(error, 'Could not update scanner'))
    } finally {
      setChangingId(null)
    }
  }

  const create = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const parsed = customScannerSchema.safeParse({
      ...form,
      weight: Number(form.weight),
      fixGuidance: form.fixGuidance.trim() || undefined,
    })
    if (!parsed.success) {
      toast.error(
        parsed.error.issues[0]?.message ?? 'Check the scanner fields.',
      )
      return
    }
    setCreating(true)
    try {
      await createCustomScanner({ data: parsed.data })
      toast.success(`${parsed.data.name} added`)
      setCreateOpen(false)
      setForm(EMPTY_FORM)
      await router.invalidate()
    } catch (error) {
      toast.error(getErrorMessage(error, 'Could not add scanner'))
    } finally {
      setCreating(false)
    }
  }

  const remove = async () => {
    if (!deleteTarget) return
    setDeleting(true)
    try {
      await deleteCustomScanner({ data: deleteTarget.id })
      toast.success(`${deleteTarget.name} removed`)
      setDeleteTarget(null)
      await router.invalidate()
    } catch (error) {
      toast.error(getErrorMessage(error, 'Could not remove scanner'))
    } finally {
      setDeleting(false)
    }
  }

  const setField = (field: keyof typeof EMPTY_FORM, value: string) => {
    setForm((current) => ({ ...current, [field]: value }))
  }

  const saveProfile = async (scanner: ScannerDefinition) => {
    const profile = profiles[scanner.id]
    if (!profile) return
    setChangingId(scanner.id)
    try {
      await setGlobalScannerExecutionProfile({
        data: {
          scannerId: scanner.id,
          model: profile.model.trim() || null,
          effort:
            (profile.effort as (typeof REASONING_EFFORTS)[number]) || null,
        },
      })
      toast.success(`${scanner.name} execution profile saved`)
      await router.invalidate()
    } catch (error) {
      toast.error(getErrorMessage(error, 'Could not update scanner profile'))
    } finally {
      setChangingId(null)
    }
  }

  return (
    <>
      <div className="flex justify-end">
        <Button onClick={() => setCreateOpen(true)}>
          <Plus aria-hidden="true" />
          Add custom scanner
        </Button>
      </div>
      <div className="grid gap-3 sm:gap-4 md:grid-cols-2">
        {scanners.map((scanner) => (
          <Card
            key={scanner.id}
            className={!scanner.enabled ? 'opacity-75' : ''}
          >
            <CardHeader>
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <CardTitle className="flex flex-wrap items-center gap-2">
                    {scanner.name}
                    <Badge variant="secondary">weight {scanner.weight}</Badge>
                    <Badge variant="outline">
                      {scanner.custom ? 'custom' : 'built-in'}
                    </Badge>
                  </CardTitle>
                  <p className="mt-2 text-sm text-muted-foreground">
                    {scanner.description}
                  </p>
                </div>
                <Switch
                  aria-label={`${scanner.enabled ? 'Disable' : 'Enable'} ${scanner.name}`}
                  checked={scanner.enabled}
                  disabled={changingId === scanner.id}
                  onCheckedChange={(enabled) => void toggle(scanner, enabled)}
                />
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              {scanner.kind !== 'dependency-audit' ? (
                <>
                  <div className="grid gap-3 border-t border-border/70 pt-3 sm:grid-cols-2">
                    <Field
                      label="Model override"
                      htmlFor={`${scanner.id}-model`}
                    >
                      <Input
                        id={`${scanner.id}-model`}
                        value={profiles[scanner.id]?.model ?? ''}
                        placeholder="Inherit scan model"
                        onChange={(event) =>
                          setProfiles((current) => ({
                            ...current,
                            [scanner.id]: {
                              ...current[scanner.id],
                              model: event.target.value,
                              effort: current[scanner.id]?.effort ?? '',
                            },
                          }))
                        }
                      />
                    </Field>
                    <Field
                      label="Effort override"
                      htmlFor={`${scanner.id}-effort`}
                    >
                      <select
                        id={`${scanner.id}-effort`}
                        className="h-10 w-full rounded-xl border border-input bg-card px-3 text-sm"
                        value={profiles[scanner.id]?.effort ?? ''}
                        onChange={(event) =>
                          setProfiles((current) => ({
                            ...current,
                            [scanner.id]: {
                              ...current[scanner.id],
                              model: current[scanner.id]?.model ?? '',
                              effort: event.target.value,
                            },
                          }))
                        }
                      >
                        <option value="">Inherit scan effort</option>
                        {REASONING_EFFORTS.map((effort) => (
                          <option key={effort} value={effort}>
                            {effort}
                          </option>
                        ))}
                      </select>
                    </Field>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={changingId === scanner.id}
                    onClick={() => void saveProfile(scanner)}
                  >
                    Save execution profile
                  </Button>
                </>
              ) : (
                <p className="border-t border-border/70 pt-3 text-xs text-muted-foreground">
                  Deterministic scanner; no model is used.
                </p>
              )}
              <details className="text-sm">
                <summary className="cursor-pointer font-semibold text-link">
                  Prompt
                </summary>
                <p className="mt-2 whitespace-pre-wrap text-muted-foreground">
                  {scanner.prompt}
                </p>
              </details>
              {scanner.custom ? (
                <Button
                  size="sm"
                  variant="ghost"
                  className="text-destructive-text"
                  onClick={() => setDeleteTarget(scanner)}
                >
                  <Trash2 aria-hidden="true" />
                  Remove
                </Button>
              ) : null}
            </CardContent>
          </Card>
        ))}
      </div>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Add custom scanner</DialogTitle>
            <DialogDescription>
              Define one focused review dimension. It will run for every new
              repository scan while enabled.
            </DialogDescription>
          </DialogHeader>
          <DialogBody>
            <form
              id="custom-scanner-form"
              onSubmit={(event) => void create(event)}
              className="space-y-4"
            >
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Scanner id" htmlFor="scanner-id">
                  <Input
                    id="scanner-id"
                    required
                    placeholder="accessibility"
                    value={form.id}
                    onChange={(event) => setField('id', event.target.value)}
                  />
                </Field>
                <Field label="Name" htmlFor="scanner-name">
                  <Input
                    id="scanner-name"
                    required
                    placeholder="Accessibility"
                    value={form.name}
                    onChange={(event) => setField('name', event.target.value)}
                  />
                </Field>
                <Field label="Short name" htmlFor="scanner-short-name">
                  <Input
                    id="scanner-short-name"
                    required
                    placeholder="A11y"
                    value={form.shortName}
                    onChange={(event) =>
                      setField('shortName', event.target.value)
                    }
                  />
                </Field>
                <Field label="Score weight" htmlFor="scanner-weight">
                  <Input
                    id="scanner-weight"
                    required
                    type="number"
                    min={0.1}
                    max={10}
                    step={0.05}
                    value={form.weight}
                    onChange={(event) => setField('weight', event.target.value)}
                  />
                </Field>
              </div>
              <Field label="Description" htmlFor="scanner-description">
                <Input
                  id="scanner-description"
                  required
                  placeholder="What this scanner measures."
                  value={form.description}
                  onChange={(event) =>
                    setField('description', event.target.value)
                  }
                />
              </Field>
              <Field label="Review instructions" htmlFor="scanner-prompt">
                <textarea
                  id="scanner-prompt"
                  required
                  rows={8}
                  placeholder="Review the repository for…"
                  className="w-full resize-y rounded-xl border border-input bg-card px-3 py-2 text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/45"
                  value={form.prompt}
                  onChange={(event) => setField('prompt', event.target.value)}
                />
              </Field>
              <Field label="Fix prompt title" htmlFor="scanner-fix-title">
                <Input
                  id="scanner-fix-title"
                  required
                  placeholder="Fix Accessibility Issues"
                  value={form.fixPromptTitle}
                  onChange={(event) =>
                    setField('fixPromptTitle', event.target.value)
                  }
                />
              </Field>
              <Field
                label="Fix guidance (optional)"
                htmlFor="scanner-fix-guidance"
              >
                <textarea
                  id="scanner-fix-guidance"
                  rows={4}
                  placeholder="Rules the fixing agent should follow…"
                  className="w-full resize-y rounded-xl border border-input bg-card px-3 py-2 text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/45"
                  value={form.fixGuidance}
                  onChange={(event) =>
                    setField('fixGuidance', event.target.value)
                  }
                />
              </Field>
            </form>
          </DialogBody>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>
              Cancel
            </Button>
            <Button
              type="submit"
              form="custom-scanner-form"
              disabled={creating}
            >
              {creating ? 'Adding…' : 'Add scanner'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={deleteTarget !== null}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remove {deleteTarget?.name}?</DialogTitle>
            <DialogDescription>
              Future scans will no longer run it. Existing findings and scan
              history are preserved.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={deleting}
              onClick={() => void remove()}
            >
              {deleting ? 'Removing…' : 'Remove scanner'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

function Field({
  label,
  htmlFor,
  children,
}: {
  readonly label: string
  readonly htmlFor: string
  readonly children: React.ReactNode
}) {
  return (
    <div className="space-y-2">
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
    </div>
  )
}
