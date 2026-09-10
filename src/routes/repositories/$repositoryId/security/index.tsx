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
        description="Editable threat-model context used for security discovery, validation, severity, and prioritization. Keep this aligned with deployed trust boundaries and product policy."
        size="compact"
        actions={
          data.profile ? (
            <Badge variant="secondary">
              v{data.profile.version} · {data.profile.source}
            </Badge>
          ) : null
        }
      />
      <SecurityProfileForm
        repositoryId={data.repository.id}
        initial={data.profile?.profile ?? EMPTY_PROFILE}
      />
    </Page>
  )
}
