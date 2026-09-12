import { createFileRoute } from '@tanstack/react-router'
import { getFindingPatchDownload } from '@/lib/server/finding-patches'

export const Route = createFileRoute('/api/patches/$patchId/')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const match = /\/api\/patches\/(\d+)\/?$/.exec(
          new URL(request.url).pathname,
        )
        const patchId = Number(match?.[1])
        if (!Number.isInteger(patchId) || patchId <= 0) {
          return Response.json({ error: 'Invalid patch.' }, { status: 400 })
        }
        const patch = await getFindingPatchDownload({ data: patchId })
        if (!patch?.diff) {
          return Response.json({ error: 'Patch not found.' }, { status: 404 })
        }
        return new Response(patch.diff, {
          headers: {
            'Content-Type': 'text/x-diff; charset=utf-8',
            'Content-Disposition': `attachment; filename="codetend-finding-${patch.findingId}-patch-${patch.id}.diff"`,
            'Cache-Control': 'private, no-store',
          },
        })
      },
    },
  },
})
