import { Link } from '@tanstack/react-router'
import type { LucideIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'

interface EmptyStateProps {
  icon: LucideIcon
  title: string
  description: string
  actionLabel: string
  actionHref: string
  actionSearch?: Record<string, unknown>
}

export function EmptyState({
  icon: Icon,
  title,
  description,
  actionLabel,
  actionHref,
  actionSearch,
}: EmptyStateProps) {
  return (
    <Card>
      <CardContent className="flex flex-col items-center justify-center py-9 text-center sm:py-12">
        <span className="mb-4 flex size-14 items-center justify-center rounded-2xl bg-accent text-accent-foreground">
          <Icon className="size-7" aria-hidden="true" />
        </span>
        <h2 className="font-display text-lg font-bold">{title}</h2>
        <p className="mt-1 mb-4 max-w-sm text-sm text-muted-foreground">
          {description}
        </p>
        <Button asChild>
          <Link to={actionHref} search={actionSearch}>
            {actionLabel}
          </Link>
        </Button>
      </CardContent>
    </Card>
  )
}
