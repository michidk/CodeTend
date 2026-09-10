import { createFileRoute } from '@tanstack/react-router'
import { Page, PageHeader } from '@/components/page-layout'
import { RepositoryForm } from '@/components/repository-form'
import { createRepository } from '@/lib/server/repositories'

export const Route = createFileRoute('/repositories/new/')({
  component: NewRepositoryPage,
})

function NewRepositoryPage() {
  return (
    <Page width="form">
      <PageHeader
        title="Add repository"
        description="Register a repository and branch to scan on a schedule."
        size="compact"
      />
      <RepositoryForm
        submitLabel="Add repository"
        onSubmit={(values) => createRepository({ data: values })}
      />
    </Page>
  )
}
