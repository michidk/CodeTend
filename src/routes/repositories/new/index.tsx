import { createFileRoute } from '@tanstack/react-router'
import { Link as LinkIcon } from 'lucide-react'
import { useState } from 'react'
import { Page, PageHeader } from '@/components/page-layout'
import { RepositoryForm } from '@/components/repository-form'
import { RouteError } from '@/components/route-error'
import { ListPending } from '@/components/route-pending'
import { Button } from '@/components/ui/button'
import {
  createRepository,
  getAvailableRepositories,
} from '@/lib/server/repositories'
import { AvailableRepositoryList } from './-components/available-repository-list'

export const Route = createFileRoute('/repositories/new/')({
  loader: () => getAvailableRepositories(),
  component: NewRepositoryPage,
  pendingComponent: ListPending,
  errorComponent: ({ error }) => <RouteError error={error} />,
})

function NewRepositoryPage() {
  const available = Route.useLoaderData()
  const [addByUrl, setAddByUrl] = useState(false)

  return (
    <Page width="form">
      <PageHeader
        title="Add repository"
        description={
          addByUrl
            ? 'Register a Git repository URL and branch.'
            : 'Choose a repository available to the configured GitHub account.'
        }
        size="compact"
        actions={
          !addByUrl ? (
            <Button variant="outline" onClick={() => setAddByUrl(true)}>
              <LinkIcon className="size-4" aria-hidden="true" />
              Add by URL
            </Button>
          ) : undefined
        }
      />
      {addByUrl ? (
        <RepositoryForm
          submitLabel="Add repository"
          onSubmit={(values) => createRepository({ data: values })}
          onCancel={() => setAddByUrl(false)}
        />
      ) : available.error ? (
        <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-5 text-sm text-destructive-text">
          {available.error}
        </div>
      ) : available.configured ? (
        <AvailableRepositoryList repositories={available.repositories} />
      ) : (
        <div className="rounded-xl border border-border bg-card p-6 text-center">
          <p className="font-display font-bold">
            GitHub access is not configured
          </p>
          <p className="mt-2 text-sm text-muted-foreground">
            Configure a GitHub App or token to browse repositories, or add one
            directly by URL.
          </p>
          <Button className="mt-4" onClick={() => setAddByUrl(true)}>
            Add by URL
          </Button>
        </div>
      )}
    </Page>
  )
}
