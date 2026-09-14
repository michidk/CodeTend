import { createFileRoute, Link } from '@tanstack/react-router'
import { ArrowLeft } from 'lucide-react'
import { EntityNotFound } from '@/components/entity-not-found'
import { Page, PageHeader } from '@/components/page-layout'
import { RouteError } from '@/components/route-error'
import { RoutePending } from '@/components/route-pending'
import { Badge } from '@/components/ui/badge'
import { parseIdParam } from '@/lib/route-params'
import type { SecurityProfile } from '@/lib/security-scans'
import { getRepositorySecurityProfile } from '@/lib/server/security-profile'
import { SecurityProfileForm } from './-components/security-profile-form'

const EMPTY_PROFILE: SecurityProfile = {
  projectOverview: '',
  assets: [],
  entryPoints: [],
  trustBoundaries: [],
  authAssumptions: [],
  sensitiveDataPaths: [],
  privilegedActions: [],
  securityInvariants: [],
  priorities: [],
  exclusions: [],
}

export const Route = createFileRoute('/repositories/$repositoryId/security/')({
  loader: ({ params }) =>
    getRepositorySecurityProfile({ data: parseIdParam(params.repositoryId) }),
  component: SecurityProfilePage,
  pendingComponent: RoutePending,
  errorComponent: ({ error }) => (
    <RouteError error={error} backTo="/" backLabel="Go to dashboard" />
  ),
})

function SecurityProfilePage() {
  const data = Route.useLoaderData()
  if (!data) {
    return (
      <EntityNotFound
        entity="Repository"
        backTo="/"
        backLabel="Go to dashboard"
      />
    )
  }
  return (
    <Page width="wide">
      <PageHeader
        eyebrow={
          <Link
            to="/repositories/$repositoryId"
            params={{ repositoryId: String(data.repository.id) }}
            className="inline-flex items-center gap-1 text-link hover:underline"
          >
            <ArrowLeft className="size-3.5" aria-hidden="true" />
            {data.repository.name}
          </Link>
        }
        title="Security profile"
        description="Durable threat-model context shared with the review agents."
        size="compact"
        actions={
          data.profile ? (
            <Badge variant="secondary">
              v{data.profile.version} · {data.profile.source}
            </Badge>
          ) : null
        }
      />
      <div className="mb-4 rounded-lg border border-blue-500/30 bg-blue-500/10 px-4 py-3 text-sm">
        Review agents build and refine this context from the repository over
        time. You can correct assumptions or add deployment and business facts
        that are not visible in source. Future scans receive your changes,
        preserve them by default, and may update or append source-grounded
        details.
      </div>
      <SecurityProfileForm
        repositoryId={data.repository.id}
        initial={data.profile?.profile ?? EMPTY_PROFILE}
      />
    </Page>
  )
}
