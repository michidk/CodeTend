import { TanStackDevtools } from '@tanstack/react-devtools'
import {
  createRootRoute,
  HeadContent,
  Outlet,
  Scripts,
  useRouter,
} from '@tanstack/react-router'
import { TanStackRouterDevtoolsPanel } from '@tanstack/react-router-devtools'
import { useEffect } from 'react'

import '../styles.css'
import { AlertTriangle, Home, RefreshCw } from 'lucide-react'
import { AppNavbar } from '@/components/app-navbar'
import { ErrorDetails } from '@/components/error-details'
import { RouteNotFound } from '@/components/route-not-found'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Toaster } from '@/components/ui/sonner'
import { TooltipProvider } from '@/components/ui/tooltip'
import { getErrorDisplayState, toDisplayableError } from '@/lib/error-display'
import { usePreferencesStore } from '@/lib/preferences-store'

const FONTS_HREF =
  'https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,500;12..96,600;12..96,700;12..96,800&family=Hanken+Grotesk:wght@400;500;600;700;800&display=swap'

/**
 * Applies the stored theme before first paint. `ThemeHydrator` takes over
 * after hydration; without this every full load flashed the light theme.
 * Mirrors the zustand persist key/shape from `@/lib/preferences-store`.
 */
const THEME_BOOT_SCRIPT = `(function(){try{var s=JSON.parse(localStorage.getItem('codetend-preferences')||'null');var t=s&&s.state&&s.state.theme;var d=t==='dark'||(t!=='light'&&matchMedia('(prefers-color-scheme: dark)').matches);var r=document.documentElement;r.classList.toggle('dark',d);r.style.colorScheme=d?'dark':'light'}catch(e){}})()`

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: 'utf-8' },
      {
        name: 'viewport',
        content: 'width=device-width, initial-scale=1, viewport-fit=cover',
      },
      { title: 'CodeTend' },
    ],
    links: [
      { rel: 'icon', type: 'image/svg+xml', href: '/favicon.svg' },
      { rel: 'preconnect', href: 'https://fonts.googleapis.com' },
      {
        rel: 'preconnect',
        href: 'https://fonts.gstatic.com',
        crossOrigin: 'anonymous',
      },
      { rel: 'stylesheet', href: FONTS_HREF },
    ],
    scripts: [{ children: THEME_BOOT_SCRIPT }],
  }),
  component: RootComponent,
  shellComponent: RootDocument,
  errorComponent: RootErrorComponent,
  notFoundComponent: () => <RouteNotFound />,
})

function RootDocument({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <HeadContent />
      </head>
      <body>
        <ThemeHydrator />
        {children}
        {import.meta.env.DEV ? (
          <TanStackDevtools
            config={{ hideUntilHover: true, position: 'middle-right' }}
            plugins={[
              {
                name: 'Tanstack Router',
                render: <TanStackRouterDevtoolsPanel />,
              },
            ]}
          />
        ) : null}
        <Scripts />
      </body>
    </html>
  )
}

function ThemeHydrator() {
  const theme = usePreferencesStore((state) => state.theme)
  const hasHydrated = usePreferencesStore((state) => state.hasHydrated)

  useEffect(() => {
    void Promise.resolve(usePreferencesStore.persist.rehydrate())
      .catch(() => undefined)
      .then(() => usePreferencesStore.getState().markHydrated())
  }, [])

  useEffect(() => {
    if (!hasHydrated) return
    const browserTheme = window.matchMedia('(prefers-color-scheme: dark)')
    const applyTheme = () => {
      const isDark =
        theme === 'dark' || (theme === 'system' && browserTheme.matches)
      document.documentElement.classList.toggle('dark', isDark)
      document.documentElement.style.colorScheme = isDark ? 'dark' : 'light'
    }
    applyTheme()
    if (theme !== 'system') return
    browserTheme.addEventListener('change', applyTheme)
    return () => browserTheme.removeEventListener('change', applyTheme)
  }, [hasHydrated, theme])

  return null
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <TooltipProvider>
      <div className="flex min-h-[100dvh] flex-col">
        <AppNavbar />
        <main
          id="main-content"
          className="mx-auto w-full max-w-7xl flex-1 px-4 py-5 md:px-8 md:py-8"
        >
          {children}
        </main>
      </div>
      <Toaster />
    </TooltipProvider>
  )
}

function RootErrorComponent({ error }: { error: unknown }) {
  const router = useRouter()
  const displayable = toDisplayableError(error)
  const errorState = getErrorDisplayState(displayable)

  return (
    <Shell>
      <div className="flex min-h-[50vh] items-center justify-center">
        <Card className="w-full max-w-md">
          <CardHeader className="text-center">
            <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-destructive/10">
              <AlertTriangle className="h-6 w-6 text-destructive" />
            </div>
            <CardTitle>{errorState.title}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-center text-sm text-muted-foreground">
              {errorState.message}
            </p>
            {errorState.hint && (
              <p className="text-center text-sm">{errorState.hint}</p>
            )}
            <div className="flex justify-center gap-2">
              <Button
                variant="outline"
                onClick={() => router.navigate({ to: '/' })}
              >
                <Home className="mr-2 h-4 w-4" />
                Go home
              </Button>
              <Button onClick={() => router.invalidate()}>
                <RefreshCw className="mr-2 h-4 w-4" />
                Try again
              </Button>
            </div>
            {import.meta.env.DEV && <ErrorDetails error={displayable} />}
          </CardContent>
        </Card>
      </div>
    </Shell>
  )
}

function RootComponent() {
  return (
    <Shell>
      <Outlet />
    </Shell>
  )
}
