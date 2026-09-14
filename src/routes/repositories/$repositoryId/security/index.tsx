import { createFileRoute, Link } from '@tanstack/react-router'
import { ArrowLeft } from 'lucide-react'
import { EntityNotFound } from '@/components/entity-not-found'
import { Page, PageHeader } from '@/components/page-layout'
import { RouteError } from '@/components/route-error'
import { RoutePending } from '@/components/route-pending'
import { Badge } from '@/components/ui/badge'
import { parseIdParam } from '@/lib/route-params'
import { getRepositorySecurityProfile } from '@/lib/server/security-profile'
import { SecurityProfileView } from './-components/security-profile-form'

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
        description="Threat-model context inferred from repository architecture, configuration, entry points, and data flows. It refreshes automatically after each complete repository scan."
        size="compact"
        actions={
          data.profile ? (
            <Badge variant="secondary">
              v{data.profile.version} · {data.profile.source}
            </Badge>
          ) : null
        }
      />
      {data.profile ? (
        <SecurityProfileView profile={data.profile.profile} />
      ) : (
        <p className="text-sm text-muted-foreground">
          Run a complete repository scan to generate the security profile.
        </p>
      )}
    </Page>
  )
}
