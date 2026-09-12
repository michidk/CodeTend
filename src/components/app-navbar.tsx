import { Link, useRouterState } from '@tanstack/react-router'
import { Activity, Plus, Radar } from 'lucide-react'
import { ThemeToggle } from '@/components/theme-toggle'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

const NAV_ITEMS = [
  { title: 'Dashboard', url: '/', exact: true },
  { title: 'Scanners', url: '/scanners', exact: false },
  { title: 'Scans', url: '/scans', exact: false },
] as const

function isActive(pathname: string, url: string, exact: boolean) {
  if (exact) return pathname === url
  return pathname === url || pathname.startsWith(`${url}/`)
}

export function AppNavbar() {
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  })

  return (
    <>
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:z-[100] focus:left-4 focus:top-4 focus:rounded-md focus:border focus:bg-background focus:px-4 focus:py-2"
      >
        Skip to content
      </a>
      <header className="sticky top-0 z-50 w-full border-b border-border bg-card/95 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-7xl items-center gap-1 px-2 sm:gap-3 sm:px-4 md:gap-6 md:px-8">
          <Link
            to="/"
            aria-label="CodeTend home"
            className="flex min-h-11 shrink-0 items-center gap-2 outline-none focus-visible:rounded-xl focus-visible:ring-3 focus-visible:ring-ring/45"
          >
            <span className="flex size-9 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-control">
              <Radar className="size-5" aria-hidden="true" />
            </span>
            <span className="hidden font-display text-xl font-extrabold tracking-tight sm:inline">
              CodeTend
            </span>
          </Link>
          <nav
            aria-label="Main navigation"
            className="flex items-center gap-0 text-xs sm:gap-1 sm:text-sm"
          >
            {NAV_ITEMS.map((item) => {
              const active = isActive(pathname, item.url, item.exact)
              return (
                <Link
                  key={item.url}
                  to={item.url}
                  aria-current={active ? 'page' : undefined}
                  className={cn(
                    'inline-flex min-h-11 items-center rounded-full px-2 py-2 text-xs font-semibold text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground sm:px-4 sm:text-sm [@media(hover:hover)_and_(pointer:fine)]:min-h-0',
                    active &&
                      'bg-primary text-primary-foreground shadow-control hover:bg-primary hover:text-primary-foreground',
                  )}
                >
                  {item.title}
                </Link>
              )
            })}
          </nav>
          <div className="ml-auto flex items-center gap-1 sm:gap-2">
            <ThemeToggle />
            <Button asChild className="gap-1.5 px-3 sm:px-5">
              <Link to="/repositories/new">
                <Plus className="size-4" />
                <span className="hidden sm:inline">Add repository</span>
                <span className="sr-only sm:hidden">Add repository</span>
              </Link>
            </Button>
          </div>
        </div>
      </header>
      <span className="sr-only">
        <Activity aria-hidden="true" />
      </span>
    </>
  )
}
