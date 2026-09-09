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
      <CardContent className="flex flex-col items-center justify-center py-10 text-center sm:py-14">
        <span className="mb-5 flex size-20 -rotate-6 animate-bob items-center justify-center rounded-[1.5rem] border-[3px] border-ink bg-candy-sun text-ink shadow-toy motion-reduce:animate-none">
          <Icon className="size-10" strokeWidth={2.25} aria-hidden="true" />
        </span>
        <h2 className="font-display text-2xl font-bold">{title}</h2>
        <p className="mt-1 mb-5 max-w-sm text-sm font-semibold text-muted-foreground">
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
