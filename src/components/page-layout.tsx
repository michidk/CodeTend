import { type ComponentProps, lazy, type ReactNode, Suspense } from 'react'
import { cn } from '@/lib/utils'

const PageHelp = lazy(() =>
  import('@/components/page-help').then((module) => ({
    default: module.PageHelp,
  })),
)

type PageWidth = 'full' | 'wide' | 'content' | 'form'

const pageWidths: Record<PageWidth, string> = {
  full: '',
  wide: 'mx-auto max-w-5xl',
  content: 'mx-auto max-w-3xl',
  form: 'mx-auto max-w-2xl',
}

interface PageProps extends ComponentProps<'div'> {
  width?: PageWidth
}

/** The shared vertical rhythm and content width for every route. */
export function Page({ width = 'full', className, ...props }: PageProps) {
  return (
    <div
      data-slot="page"
      className={cn(
        'w-full space-y-5 md:space-y-8',
        pageWidths[width],
        className,
      )}
      {...props}
    />
  )
}

interface PageHeaderProps extends Omit<ComponentProps<'header'>, 'title'> {
  title: ReactNode
  description?: ReactNode
  help?: ReactNode
  eyebrow?: ReactNode
  leading?: ReactNode
  actions?: ReactNode
  size?: 'default' | 'compact'
}

/** A responsive route heading with one stable alignment for titles and actions. */
export function PageHeader({
  title,
  description,
  help,
  eyebrow,
  leading,
  actions,
  size = 'default',
  className,
  ...props
}: PageHeaderProps) {
  return (
    <header
      data-slot="page-header"
      className={cn(
        'flex flex-col gap-3 sm:flex-row sm:justify-between sm:gap-4',
        size === 'compact' ? 'sm:items-center' : 'sm:items-end',
        className,
      )}
      {...props}
    >
      <div className="flex min-w-0 items-start gap-3 sm:gap-4">
        {leading ? <div className="shrink-0">{leading}</div> : null}
        <div className="min-w-0">
          {eyebrow ? (
            <p className="mb-2 inline-flex items-center rounded-full border-2 border-ink bg-candy-sun px-2.5 py-0.5 text-xs font-extrabold uppercase tracking-wide text-ink">
              {eyebrow}
            </p>
          ) : null}
          <div className="flex items-center gap-2">
            <h1
              className={cn(
                'min-w-0 break-words font-display font-bold tracking-tight text-foreground',
                size === 'compact'
                  ? 'text-3xl sm:text-4xl'
                  : 'text-4xl md:text-6xl',
              )}
            >
              {title}
            </h1>
            {help ? (
              <Suspense fallback={null}>
                <PageHelp>{help}</PageHelp>
              </Suspense>
            ) : null}
          </div>
          {description ? (
            <p className="mt-2 max-w-2xl text-base font-semibold leading-relaxed text-muted-foreground">
              {description}
            </p>
          ) : null}
        </div>
      </div>
      {actions ? (
        <div className="flex shrink-0 flex-wrap items-center gap-2 sm:justify-end">
          {actions}
        </div>
      ) : null}
    </header>
  )
}

interface SectionHeadingProps extends ComponentProps<'h2'> {
  /** Candy background class for the little block that leads the heading. */
  color?: string
}

/** A section title with a tilted colour block, like a label on a toy bin. */
export function SectionHeading({
  color = 'bg-candy-sun',
  className,
  children,
  ...props
}: SectionHeadingProps) {
  return (
    <h2
      className={cn(
        'flex items-center gap-3 font-display text-2xl font-bold',
        className,
      )}
      {...props}
    >
      <span
        aria-hidden="true"
        className={cn(
          'inline-block size-5 shrink-0 rotate-12 rounded-md border-2 border-ink shadow-toy-sm',
          color,
        )}
      />
      <span>{children}</span>
    </h2>
  )
}
