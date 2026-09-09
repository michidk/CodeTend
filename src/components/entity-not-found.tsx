import { Link } from '@tanstack/react-router'
import { Page } from '@/components/page-layout'
import { Button } from '@/components/ui/button'

interface EntityNotFoundProps {
  entity: string
  backTo: string
  backLabel: string
}

/** Dead-end for detail pages whose loader returned no record. */
export function EntityNotFound({
  entity,
  backTo,
  backLabel,
}: EntityNotFoundProps) {
  return (
    <Page width="form">
      <div className="py-12 text-center">
        <span className="mx-auto mb-4 flex size-16 rotate-6 items-center justify-center rounded-2xl border-[3px] border-ink bg-candy-sun font-display text-4xl font-bold text-ink shadow-toy">
          ?
        </span>
        <h2 className="font-display text-3xl font-bold">{entity} not found</h2>
        <Button asChild className="mt-4">
          <Link to={backTo}>{backLabel}</Link>
        </Button>
      </div>
    </Page>
  )
}
