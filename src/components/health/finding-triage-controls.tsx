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
import { setFindingDisposition } from '@/lib/server/finding-triage'

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
  const [action, setAction] = useState<FindingDisposition | null>(null)
  const [note, setNote] = useState(dispositionNote ?? '')
  const [pending, setPending] = useState(false)

  const save = async (next: FindingDisposition | null) => {
    setPending(true)
    try {
      await setFindingDisposition({
        data: { findingId, disposition: next, note: next ? note : '' },
      })
      toast.success(
        next === null
          ? 'Finding reopened'
          : next === 'false_positive'
            ? 'Marked as false positive'
            : 'Risk accepted',
      )
      setAction(null)
      await router.invalidate()
    } catch (error) {
      toast.error(getErrorMessage(error, 'Could not update the finding'))
    } finally {
      setPending(false)
    }
  }

  if (disposition) {
    return (
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-muted/50 p-3">
        <div>
          <p className="font-semibold">
            {disposition === 'false_positive'
              ? 'Marked false positive'
              : 'Risk accepted'}
          </p>
          {dispositionNote ? (
            <p className="mt-0.5 text-xs text-muted-foreground">
              {dispositionNote}
            </p>
          ) : null}
        </div>
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
    )
  }

  return (
    <>
      <div className="flex flex-wrap gap-2 border-t border-border pt-3">
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

      <Dialog
        open={action !== null}
        onOpenChange={(open) => {
          if (!open && !pending) setAction(null)
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {action === 'accepted_risk'
                ? 'Accept this risk?'
                : 'Mark as false positive?'}
            </DialogTitle>
            <DialogDescription>
              This is an operator decision, not a code fix. Future scans keep
              the finding suppressed until it is reopened.
            </DialogDescription>
          </DialogHeader>
          <DialogBody>
            <Label htmlFor={`triage-note-${findingId}`}>
              Reason{action === 'accepted_risk' ? ' (required)' : ' (optional)'}
            </Label>
            <textarea
              id={`triage-note-${findingId}`}
              value={note}
              onChange={(event) => setNote(event.target.value)}
              maxLength={2_000}
              rows={4}
              className="mt-2 w-full resize-y rounded-xl border border-input bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
              placeholder="Record the evidence or decision for future reviewers."
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
                (action === 'accepted_risk' && note.trim().length < 5)
              }
              onClick={() => action && void save(action)}
            >
              {pending ? 'Saving…' : 'Confirm'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
