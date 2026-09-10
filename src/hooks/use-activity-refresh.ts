import { useRouter } from '@tanstack/react-router'
import { useEffect } from 'react'
import { type ActivityScope, getActivityStatus } from '@/lib/server/activity'

const POLL_INTERVAL_MS = 4_000

/**
 * Keeps a page current while scans or patches run without re-running its
 * loader on every tick. The page passes `active` from its loader data; while
 * true, this polls a tiny status fingerprint and invalidates the router only
 * when the fingerprint changes (a phase advanced, something finished). One
 * extra poll after `active` flips false catches the final state.
 */
export function useActivityRefresh(scope: ActivityScope, active: boolean) {
  const router = useRouter()
  const scopeKey = JSON.stringify(scope)

  useEffect(() => {
    if (!active) return
    const parsedScope = JSON.parse(scopeKey) as ActivityScope
    let lastSignature: string | null = null
    let inFlight = false
    let cancelled = false

    const tick = async () => {
      if (inFlight || cancelled || document.hidden) return
      inFlight = true
      try {
        const status = await getActivityStatus({ data: parsedScope })
        if (cancelled) return
        const changed =
          lastSignature !== null && status.signature !== lastSignature
        lastSignature = status.signature
        if (changed || !status.busy) await router.invalidate()
      } catch {
        // Transient network errors just skip a tick.
      } finally {
        inFlight = false
      }
    }

    const timer = window.setInterval(() => void tick(), POLL_INTERVAL_MS)
    const onVisible = () => {
      if (!document.hidden) void tick()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      cancelled = true
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [active, router, scopeKey])
}
