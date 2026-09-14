import { useNavigate } from '@tanstack/react-router'
import { Archive, GitBranch, Lock, Search } from 'lucide-react'
import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { getErrorMessage } from '@/lib/error-message'
import {
  createRepository,
  type getAvailableRepositories,
} from '@/lib/server/repositories'

type AvailableRepository = Awaited<
  ReturnType<typeof getAvailableRepositories>
>['repositories'][number]

export function AvailableRepositoryList({
  repositories,
}: {
  readonly repositories: AvailableRepository[]
}) {
  const navigate = useNavigate()
  const [query, setQuery] = useState('')
  const [adding, setAdding] = useState<string | null>(null)
  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase()
    if (!normalized) return repositories
    return repositories.filter((repository) =>
      repository.name.toLowerCase().includes(normalized),
    )
  }, [query, repositories])

  const add = async (repository: AvailableRepository) => {
    setAdding(repository.name)
    try {
      const saved = await createRepository({
        data: {
          name: repository.name,
          url: repository.url,
          branch: repository.branch,
        },
      })
      toast.success(`${repository.name} added`)
      await navigate({
        to: '/repositories/$repositoryId',
        params: { repositoryId: String(saved.id) },
      })
    } catch (error) {
      toast.error(getErrorMessage(error, 'Could not add the repository'))
      setAdding(null)
    }
  }

  return (
    <div className="space-y-4">
      <div className="relative">
        <Search
          className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden="true"
        />
        <Input
          aria-label="Search available repositories"
          className="pl-9"
          placeholder="Search repositories…"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </div>

      {filtered.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center text-sm text-muted-foreground">
            {query
              ? 'No repositories match your search.'
              : 'No available repositories were found.'}
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {filtered.map((repository) => (
            <Card key={repository.name} className="py-0">
              <CardContent className="flex items-center gap-3 p-3 sm:p-4">
                <div className="min-w-0 flex-1">
                  <div className="flex min-w-0 items-center gap-2">
                    <p className="truncate font-display font-bold">
                      {repository.name}
                    </p>
                    {repository.private ? (
                      <Lock
                        className="size-3.5 shrink-0 text-muted-foreground"
                        aria-label="Private repository"
                      />
                    ) : null}
                    {repository.archived ? (
                      <Archive
                        className="size-3.5 shrink-0 text-muted-foreground"
                        aria-label="Archived repository"
                      />
                    ) : null}
                  </div>
                  <p className="mt-1 flex items-center gap-1 truncate text-xs text-muted-foreground">
                    <GitBranch className="size-3" aria-hidden="true" />
                    {repository.branch}
                  </p>
                </div>
                <Button
                  size="sm"
                  variant={repository.registered ? 'outline' : 'default'}
                  disabled={repository.registered || adding !== null}
                  onClick={() => void add(repository)}
                >
                  {repository.registered
                    ? 'Added'
                    : adding === repository.name
                      ? 'Adding…'
                      : 'Add'}
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}
