import { Link, useRouterState } from '@tanstack/react-router'
import { Activity, Plus, Radar } from 'lucide-react'
import { ThemeToggle } from '@/components/theme-toggle'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

const NAV_ITEMS = [
  { title: 'Dashboard', url: '/', exact: true, color: 'bg-candy-sun' },
  { title: 'Scanners', url: '/scanners', exact: false, color: 'bg-candy-sky' },
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
        className="sr-only focus:not-sr-only focus:absolute focus:z-[100] focus:left-4 focus:top-4 focus:rounded-full focus:border-[3px] focus:border-ink focus:bg-candy-sun focus:px-4 focus:py-2 focus:font-bold"
      >
        Skip to content
      </a>
      <header className="sticky top-0 z-50 w-full border-b-[3px] border-ink bg-card">
        <div className="mx-auto flex min-h-18 max-w-7xl items-center gap-1.5 px-3 py-2 sm:gap-3 sm:px-4 md:gap-6 md:px-8">
          <Link
            to="/"
            aria-label="tecdebt home"
            className="group flex min-h-11 shrink-0 items-center gap-2.5 outline-none focus-visible:rounded-full focus-visible:ring-3 focus-visible:ring-ring/60 focus-visible:ring-offset-2 focus-visible:ring-offset-card"
          >
            <span className="flex size-11 -rotate-6 items-center justify-center rounded-2xl border-[3px] border-ink bg-primary text-ink shadow-toy-sm transition-transform duration-300 ease-spring group-hover:rotate-6 group-hover:scale-105 motion-reduce:transition-none">
              <Radar className="size-6" aria-hidden="true" strokeWidth={2.5} />
            </span>
            <span className="hidden font-display text-2xl font-bold tracking-tight sm:inline">
              tec<span className="text-primary">debt</span>
            </span>
          </Link>
          <nav
            aria-label="Main navigation"
            className="flex items-center gap-1.5 text-sm sm:gap-2"
          >
            {NAV_ITEMS.map((item) => {
              const active = isActive(pathname, item.url, item.exact)
              return (
                <Link
                  key={item.url}
                  to={item.url}
                  aria-current={active ? 'page' : undefined}
                  className={cn(
                    'inline-flex min-h-11 items-center rounded-full border-[3px] px-2.5 py-1.5 font-display text-sm font-semibold sm:px-4 sm:text-base transition-[transform,box-shadow,background-color,border-color] duration-200 ease-spring outline-none focus-visible:ring-3 focus-visible:ring-ring/60 focus-visible:ring-offset-2 focus-visible:ring-offset-card motion-reduce:transition-none [@media(hover:hover)_and_(pointer:fine)]:min-h-0',
                    active
                      ? cn(
                          'border-ink text-ink shadow-toy-sm hover:-translate-y-0.5',
                          item.color,
                        )
                      : 'border-transparent text-muted-foreground hover:-translate-y-0.5 hover:border-ink hover:bg-card hover:text-foreground hover:shadow-toy-sm',
                  )}
                >
                  {item.title}
                </Link>
              )
            })}
          </nav>
          <div className="ml-auto flex items-center gap-1 sm:gap-2">
            <ThemeToggle />
            <Button asChild className="gap-1.5">
              <Link to="/repositories/new">
                <Plus className="size-4" strokeWidth={3} />
                <span className="hidden sm:inline">Add repository</span>
                <span className="sm:hidden">Add</span>
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
