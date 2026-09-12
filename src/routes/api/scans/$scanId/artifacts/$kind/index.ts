import { createFileRoute } from '@tanstack/react-router'
import { getScanArtifact } from '@/lib/server/scan-artifacts'

const KINDS = new Set(['manifest', 'findings', 'coverage', 'report', 'sarif'])

export const Route = createFileRoute('/api/scans/$scanId/artifacts/$kind/')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const match = /\/api\/scans\/(\d+)\/artifacts\/([^/]+)\/?$/.exec(
          new URL(request.url).pathname,
        )
        const scanId = Number(match?.[1])
        const kind = match?.[2] ?? ''
        if (!Number.isInteger(scanId) || scanId <= 0 || !KINDS.has(kind)) {
          return Response.json({ error: 'Invalid artifact.' }, { status: 400 })
        }
        const artifact = await getScanArtifact(
          scanId,
          kind as 'manifest' | 'findings' | 'coverage' | 'report' | 'sarif',
        )
        if (!artifact) {
          return Response.json(
            { error: 'Artifact not found.' },
            { status: 404 },
          )
        }
        const extension =
          kind === 'report' ? 'md' : kind === 'sarif' ? 'sarif' : 'json'
        return new Response(artifact.contents, {
          headers: {
            'Content-Type': artifact.contentType,
            'Content-Disposition': `attachment; filename="codetend-scan-${scanId}-${kind}.${extension}"`,
            ETag: `"${artifact.sha256}"`,
            'Cache-Control': 'private, no-store',
          },
        })
      },
    },
  },
})
