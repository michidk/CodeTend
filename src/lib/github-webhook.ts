import { createHmac, timingSafeEqual } from 'node:crypto'
import { z } from 'zod'
import type { ScanTarget } from '@/lib/security-scans'

const GITHUB_SIGNATURE = /^sha256=([a-f0-9]{64})$/i
const COMMIT_SHA = /^[0-9a-f]{40}$/i
const ZERO_SHA = /^0{40}$/

const pushSchema = z.object({
  ref: z.string(),
  before: z.string(),
  after: z.string(),
  deleted: z.boolean().optional().default(false),
  repository: z.object({ full_name: z.string() }),
})

const pullRequestSchema = z.object({
  action: z.string(),
  pull_request: z.object({
    draft: z.boolean().optional().default(false),
    base: z.object({
      ref: z.string(),
      sha: z.string(),
      repo: z.object({ full_name: z.string() }),
    }),
    head: z.object({ sha: z.string() }),
  }),
})

const PULL_REQUEST_ACTIONS = new Set([
  'opened',
  'reopened',
  'synchronize',
  'ready_for_review',
])

export type GitHubScanEvent =
  | {
      readonly status: 'scan'
      readonly slug: string
      readonly branch: string
      readonly target: ScanTarget
    }
  | { readonly status: 'ignored'; readonly reason: string }
  | { readonly status: 'invalid'; readonly reason: string }

export function parseGitHubScanEvent(
  event: string | null,
  body: unknown,
): GitHubScanEvent {
  if (event === 'push') {
    const parsed = pushSchema.safeParse(body)
    if (!parsed.success)
      return { status: 'invalid', reason: 'Invalid push payload.' }
    const branch = parsed.data.ref.replace(/^refs\/heads\//, '')
    if (branch === parsed.data.ref) {
      return { status: 'ignored', reason: 'not a branch' }
    }
    if (parsed.data.deleted || ZERO_SHA.test(parsed.data.after)) {
      return { status: 'ignored', reason: 'branch deleted' }
    }
    if (!COMMIT_SHA.test(parsed.data.after)) {
      return { status: 'invalid', reason: 'Invalid push commit SHA.' }
    }
    const target: ScanTarget =
      COMMIT_SHA.test(parsed.data.before) && !ZERO_SHA.test(parsed.data.before)
        ? { kind: 'diff', base: parsed.data.before, head: parsed.data.after }
        : { kind: 'repository' }
    return {
      status: 'scan',
      slug: parsed.data.repository.full_name.toLowerCase(),
      branch,
      target,
    }
  }

  if (event === 'pull_request') {
    const parsed = pullRequestSchema.safeParse(body)
    if (!parsed.success) {
      return { status: 'invalid', reason: 'Invalid pull request payload.' }
    }
    if (!PULL_REQUEST_ACTIONS.has(parsed.data.action)) {
      return {
        status: 'ignored',
        reason: 'pull request action is not scannable',
      }
    }
    const { base, head, draft } = parsed.data.pull_request
    if (draft && parsed.data.action !== 'ready_for_review') {
      return { status: 'ignored', reason: 'draft pull request' }
    }
    if (!COMMIT_SHA.test(base.sha) || !COMMIT_SHA.test(head.sha)) {
      return { status: 'invalid', reason: 'Invalid pull request commit SHA.' }
    }
    return {
      status: 'scan',
      slug: base.repo.full_name.toLowerCase(),
      branch: base.ref,
      target: { kind: 'diff', base: base.sha, head: head.sha },
    }
  }

  return {
    status: 'ignored',
    reason: `unsupported event: ${event ?? 'missing'}`,
  }
}

export function verifyGitHubSignature(
  payload: Uint8Array,
  signature: string | null,
  secret: string,
): boolean {
  const match = signature?.match(GITHUB_SIGNATURE)
  if (!match?.[1]) return false

  const actual = Buffer.from(match[1], 'hex')
  const expected = createHmac('sha256', secret).update(payload).digest()
  return actual.length === expected.length && timingSafeEqual(actual, expected)
}

export function githubRepositorySlug(repositoryUrl: string): string | null {
  const scpMatch = /^git@github\.com:([^/]+\/[^/#]+?)(?:\.git)?$/i.exec(
    repositoryUrl,
  )
  if (scpMatch?.[1]) return normalizeSlug(scpMatch[1])

  try {
    const url = new URL(repositoryUrl)
    if (url.hostname.toLowerCase() !== 'github.com') return null
    if (!['https:', 'ssh:', 'git:'].includes(url.protocol)) return null
    return normalizeSlug(url.pathname)
  } catch {
    return null
  }
}

function normalizeSlug(value: string): string | null {
  const slug = value.replace(/^\/+|\/+$/g, '').replace(/\.git$/i, '')
  return /^[^/]+\/[^/]+$/.test(slug) ? slug.toLowerCase() : null
}
