import { useRouter } from '@tanstack/react-router'
import { Check, Download, Hammer, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import type { FindingPatch } from '@/db/schema'
import { getErrorMessage } from '@/lib/error-message'
import { formatCostUsd, formatTokens } from '@/lib/format'
import {
  decideFindingPatch,
  generateFindingPatch,
} from '@/lib/server/finding-patches'

export function FindingPatchControls({
  findingId,
  patches,
  disabled,
}: {
  readonly findingId: number
  readonly patches: readonly FindingPatch[]
  readonly disabled: boolean
}) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const latest = patches[0] ?? null
  const generating = latest?.status === 'generating'

  useEffect(() => {
    if (!generating) return
    const timer = window.setInterval(() => void router.invalidate(), 4_000)
    return () => window.clearInterval(timer)
  }, [generating, router])

  const generate = async () => {
    setBusy(true)
    try {
      await generateFindingPatch({ data: findingId })
      toast.success('Patch generation started')
      await router.invalidate()
    } catch (error) {
      toast.error(getErrorMessage(error, 'Could not generate the patch'))
    } finally {
      setBusy(false)
    }
  }

  const decide = async (decision: 'accepted' | 'rejected') => {
    if (!latest) return
    setBusy(true)
    try {
      await decideFindingPatch({ data: { patchId: latest.id, decision } })
      toast.success(
        decision === 'accepted' ? 'Patch approved' : 'Patch rejected',
      )
      await router.invalidate()
    } catch (error) {
      toast.error(getErrorMessage(error, 'Could not update the patch'))
    } finally {
      setBusy(false)
    }
  }

  const canGenerate =
    !disabled &&
    (!latest || latest.status === 'failed' || latest.status === 'rejected')
  const awaitingReview =
    latest?.status === 'proposed' || latest?.status === 'verified'

  return (
    <div className="space-y-2 rounded-xl border border-border p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Reviewed patch
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Generated in a disposable clone. Approval never pushes or modifies
            the source repository.
          </p>
        </div>
        {latest ? (
          <Badge variant="outline" className="capitalize">
            {latest.status}
          </Badge>
        ) : null}
      </div>

      {latest ? (
        <>
          <p className="whitespace-pre-wrap text-sm">{latest.summary}</p>
          {latest.verification ? (
            <p className="text-xs text-muted-foreground">
              Reproducer after patch:{' '}
              <span className="font-semibold capitalize">
                {latest.verification.status.replaceAll('_', ' ')}
              </span>
              {latest.verification.proofGaps.length
                ? ` · ${latest.verification.proofGaps.join('; ')}`
                : ''}
            </p>
          ) : null}
          {latest.modelCalls != null ? (
            <p className="text-xs text-muted-foreground">
              AI usage: {latest.model ?? 'unknown model'} · {latest.modelCalls}{' '}
              {latest.modelCalls === 1 ? 'call' : 'calls'} ·{' '}
              {formatTokens(
                (latest.inputTokens ?? 0) +
                  (latest.outputTokens ?? 0) +
                  (latest.cacheReadTokens ?? 0) +
                  (latest.cacheWriteTokens ?? 0),
              )}{' '}
              tokens · {formatCostUsd(latest.estimatedCostUsd)}
            </p>
          ) : null}
          {latest.diff ? (
            <details>
              <summary className="cursor-pointer text-xs font-semibold text-link">
                Review unified diff
              </summary>
              <pre className="mt-2 max-h-96 overflow-auto whitespace-pre rounded-lg bg-muted p-3 text-xs">
                {latest.diff}
              </pre>
            </details>
          ) : null}
        </>
      ) : null}

      <div className="flex flex-wrap gap-2">
        {canGenerate ? (
          <Button
            size="sm"
            variant="outline"
            onClick={() => void generate()}
            disabled={busy}
          >
            <Hammer className="size-3.5" aria-hidden="true" />
            {busy
              ? 'Starting…'
              : latest
                ? 'Generate another'
                : 'Generate patch'}
          </Button>
        ) : null}
        {generating ? (
          <Button size="sm" variant="outline" disabled>
            <Hammer className="size-3.5" aria-hidden="true" />
            Generating…
          </Button>
        ) : null}
        {latest?.diff ? (
          <Button size="sm" variant="outline" asChild>
            <a href={`/api/patches/${latest.id}`} download>
              <Download className="size-3.5" aria-hidden="true" />
              Download diff
            </a>
          </Button>
        ) : null}
        {awaitingReview ? (
          <>
            <Button
              size="sm"
              onClick={() => void decide('accepted')}
              disabled={busy}
            >
              <Check className="size-3.5" aria-hidden="true" />
              Approve
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => void decide('rejected')}
              disabled={busy}
            >
              <X className="size-3.5" aria-hidden="true" />
              Reject
            </Button>
          </>
        ) : null}
      </div>
    </div>
  )
}
