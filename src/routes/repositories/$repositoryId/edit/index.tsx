import { createFileRoute } from '@tanstack/react-router'
import { EntityNotFound } from '@/components/entity-not-found'
import { Page, PageHeader } from '@/components/page-layout'
import { RepositoryForm } from '@/components/repository-form'
import { RouteError } from '@/components/route-error'
import { DetailPending } from '@/components/route-pending'
import { parseIdParam } from '@/lib/route-params'
import { updateRepository } from '@/lib/server/repositories'
import { getRepositoryDetail } from '@/lib/server/repository-detail'

export const Route = createFileRoute('/repositories/$repositoryId/edit/')({
  loader: ({ params }) =>
    getRepositoryDetail({ data: parseIdParam(params.repositoryId) }),
  component: EditRepositoryPage,
  pendingComponent: DetailPending,
  errorComponent: ({ error }) => (
    <RouteError error={error} backTo="/" backLabel="Go to dashboard" />
  ),
})

function EditRepositoryPage() {
  const detail = Route.useLoaderData()
  if (!detail)
    return (
      <EntityNotFound
        entity="Repository"
        backTo="/"
        backLabel="Go to dashboard"
      />
    )
  const { repository } = detail
  return (
    <Page width="form">
      <PageHeader title={`Edit ${repository.name}`} size="compact" />
      <RepositoryForm
        submitLabel="Save changes"
        initialValues={{
          name: repository.name,
          url: repository.url,
          branch: repository.branch,
          scheduleEnabled: repository.scheduleEnabled,
          scheduleCronExpression: repository.scheduleCronExpression,
        }}
        globalSchedule={detail.globalSchedule}
        onSubmit={(values) =>
          updateRepository({ data: { ...values, id: repository.id } })
        }
      />
    </Page>
  )
}
