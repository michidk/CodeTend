'use client'

import { useRouter } from '@tanstack/react-router'
import { useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { getErrorMessage } from '@/lib/error-message'
import type { FindingDisposition } from '@/lib/findings'
import {
  markFindingFixed,
  setFindingDisposition,
} from '@/lib/server/finding-triage'

const DISPOSITION_LABELS: Record<FindingDisposition, string> = {
  false_positive: 'Marked false positive',
  accepted_risk: 'Risk accepted',
}

type TriageAction = FindingDisposition | 'fixed'

export function FindingTriageControls({
  findingId,
  disposition,
  dispositionNote,
}: {
  readonly findingId: number
  readonly disposition: FindingDisposition | null
  readonly dispositionNote: string | null
}) {
  const router = useRouter()
  const [action, setAction] = useState<TriageAction | null>(null)
  const [note, setNote] = useState(dispositionNote ?? '')
  const [pending, setPending] = useState(false)
  const editing =
    action !== null && action !== 'fixed' && action === disposition

  const saveFixed = async () => {
    setPending(true)
    try {
      await markFindingFixed({ data: { findingId, note } })
      toast.success('Finding marked as fixed')
      setAction(null)
      await router.invalidate()
    } catch (error) {
      toast.error(getErrorMessage(error, 'Could not mark the finding as fixed'))
    } finally {
      setPending(false)
    }
  }

  const save = async (next: FindingDisposition | null) => {
    setPending(true)
    try {
      await setFindingDisposition({
        data: { findingId, disposition: next, note: next ? note : '' },
      })
      toast.success(
        next === null
          ? 'Finding reopened'
          : editing
            ? 'Context updated'
            : DISPOSITION_LABELS[next],
      )
      setAction(null)
      await router.invalidate()
    } catch (error) {
      toast.error(getErrorMessage(error, 'Could not update the finding'))
    } finally {
      setPending(false)
    }
  }

  const dialog = (
    <Dialog
      open={action !== null}
      onOpenChange={(open) => {
        if (!open && !pending) setAction(null)
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {action === 'fixed'
              ? 'Mark this finding as fixed?'
              : editing
                ? 'Edit context'
                : action === 'accepted_risk'
                  ? 'Accept this risk?'
                  : 'Mark as false positive?'}
          </DialogTitle>
          <DialogDescription>
            {action === 'fixed'
              ? 'This records an operator-reported fix. The next scan verifies the current code and will regress the finding if it is detected again.'
              : 'This is an operator decision, not a code fix. Future scans keep the finding suppressed and only reopen it when the scanner can show that this context no longer matches the code, so record the controls, assumptions or constraints that justify it.'}
          </DialogDescription>
        </DialogHeader>
        <DialogBody>
          <Label htmlFor={`triage-note-${findingId}`}>
            {action === 'fixed' ? 'What changed (required)' : 'Context'}
            {action === 'accepted_risk' ? ' (required)' : null}
            {action === 'false_positive' ? ' (optional)' : null}
          </Label>
          <textarea
            id={`triage-note-${findingId}`}
            value={note}
            onChange={(event) => setNote(event.target.value)}
            maxLength={2_000}
            rows={4}
            className="mt-2 w-full resize-y rounded-xl border border-input bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
            placeholder={
              action === 'fixed'
                ? 'Describe the code or configuration change that fixed this finding.'
                : 'Why this is acceptable here, e.g. the endpoint is internal-only behind the VPN and rate limited at the gateway.'
            }
          />
        </DialogBody>
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            disabled={pending}
            onClick={() => setAction(null)}
          >
            Cancel
          </Button>
          <Button
            type="button"
            disabled={
              pending ||
              ((action === 'accepted_risk' || action === 'fixed') &&
                note.trim().length < 5)
            }
            onClick={() => {
              if (action === 'fixed') void saveFixed()
              else if (action) void save(action)
            }}
          >
            {pending ? 'Saving…' : editing ? 'Save' : 'Confirm'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )

  if (disposition) {
    return (
      <>
        <div className="flex flex-wrap items-start justify-between gap-2 rounded-lg border border-border bg-muted/50 p-3">
          <div className="min-w-0">
            <p className="font-semibold">{DISPOSITION_LABELS[disposition]}</p>
            <p className="mt-0.5 whitespace-pre-wrap text-xs text-muted-foreground">
              {dispositionNote ?? 'No context recorded.'}
            </p>
          </div>
          <div className="flex shrink-0 gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={pending}
              onClick={() => {
                setNote(dispositionNote ?? '')
                setAction(disposition)
              }}
            >
              Edit context
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={pending}
              onClick={() => void save(null)}
            >
              Reopen
            </Button>
          </div>
        </div>
        {dialog}
      </>
    )
  }

  return (
    <>
      <div className="flex flex-wrap gap-2 border-t border-border pt-3">
        <Button
          type="button"
          size="sm"
          onClick={() => {
            setNote('')
            setAction('fixed')
          }}
        >
          Mark as fixed
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => {
            setNote('')
            setAction('false_positive')
          }}
        >
          False positive
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => {
            setNote('')
            setAction('accepted_risk')
          }}
        >
          Accept risk
        </Button>
      </div>
      {dialog}
    </>
  )
}
