import { eq, lt } from 'drizzle-orm'
import { db } from '@/db'
import { githubWebhookDeliveries, repositories } from '@/db/schema'
import { getServerEnv } from '@/lib/env.server'
import {
  githubRepositorySlug,
  parseGitHubScanEvent,
  verifyGitHubSignature,
} from '@/lib/github-webhook'
import { startScan } from '@/lib/server/scan-pipeline.server'

const MAX_PAYLOAD_BYTES = 1_000_000
const DELIVERY_RETENTION_MS = 30 * 24 * 60 * 60_000

export async function handleGitHubWebhook(request: Request): Promise<Response> {
  const env = getServerEnv()
  if (!env.GITHUB_WEBHOOK_SECRET) {
    return Response.json(
      { error: 'GitHub webhooks are not configured.' },
      { status: 503 },
    )
  }

  const declaredLength = Number(request.headers.get('content-length'))
  if (Number.isFinite(declaredLength) && declaredLength > MAX_PAYLOAD_BYTES) {
    return Response.json({ error: 'Payload too large.' }, { status: 413 })
  }
  const payload = new Uint8Array(await request.arrayBuffer())
  if (payload.byteLength > MAX_PAYLOAD_BYTES) {
    return Response.json({ error: 'Payload too large.' }, { status: 413 })
  }
  if (
    !verifyGitHubSignature(
      payload,
      request.headers.get('x-hub-signature-256'),
      env.GITHUB_WEBHOOK_SECRET,
    )
  ) {
    return Response.json({ error: 'Invalid signature.' }, { status: 401 })
  }

  const event = request.headers.get('x-github-event')
  if (event === 'ping') return Response.json({ status: 'ok' })

  let body: unknown
  try {
    body = JSON.parse(new TextDecoder().decode(payload)) as unknown
  } catch {
    return Response.json({ error: 'Invalid JSON payload.' }, { status: 400 })
  }
  const scanEvent = parseGitHubScanEvent(event, body)
  if (scanEvent.status === 'invalid') {
    return Response.json({ error: scanEvent.reason }, { status: 400 })
  }
  if (scanEvent.status === 'ignored') {
    return Response.json(
      { status: 'ignored', reason: scanEvent.reason },
      { status: 202 },
    )
  }

  const deliveryId = request.headers.get('x-github-delivery')
  if (!deliveryId || !/^[a-zA-Z0-9-]{1,100}$/.test(deliveryId)) {
    return Response.json(
      { error: 'Missing or invalid delivery ID.' },
      { status: 400 },
    )
  }
  const claimed = await db
    .insert(githubWebhookDeliveries)
    .values({ deliveryId, event: event ?? 'unknown' })
    .onConflictDoNothing()
    .returning({ deliveryId: githubWebhookDeliveries.deliveryId })
  if (claimed.length === 0) {
    return Response.json(
      { status: 'ignored', reason: 'duplicate delivery' },
      { status: 202 },
    )
  }

  try {
    const candidates = await db.query.repositories.findMany({
      where: eq(repositories.enabled, true),
    })
    const matching = candidates.filter(
      (repository) =>
        repository.branch === scanEvent.branch &&
        githubRepositorySlug(repository.url) === scanEvent.slug,
    )
    const scansStarted: number[] = []
    for (const repository of matching) {
      const scanId = await startScan(repository.id, 'webhook', {
        target: scanEvent.target,
      })
      if (scanId !== null) scansStarted.push(scanId)
    }

    await db
      .delete(githubWebhookDeliveries)
      .where(
        lt(
          githubWebhookDeliveries.createdAt,
          new Date(Date.now() - DELIVERY_RETENTION_MS),
        ),
      )
    return Response.json({ status: 'accepted', scansStarted }, { status: 202 })
  } catch (error) {
    // Let GitHub retry a delivery that failed before it was accepted.
    await db
      .delete(githubWebhookDeliveries)
      .where(eq(githubWebhookDeliveries.deliveryId, deliveryId))
    throw error
  }
}
