import { createFileRoute } from '@tanstack/react-router'
import { getSystemHealth } from '@/lib/server/health'

export const Route = createFileRoute('/api/health')({
  server: {
    handlers: {
      GET: async () => {
        const headers = { 'Cache-Control': 'no-store' }
        try {
          return Response.json(await getSystemHealth(), { headers })
        } catch {
          return Response.json(
            { status: 'unavailable' },
            { status: 503, headers },
          )
        }
      },
    },
  },
})
