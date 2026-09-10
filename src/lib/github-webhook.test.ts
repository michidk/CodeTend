import { describe, expect, test } from 'bun:test'
import { createHmac } from 'node:crypto'
import {
  githubRepositorySlug,
  parseGitHubScanEvent,
  verifyGitHubSignature,
} from './github-webhook'

describe('GitHub webhook authentication', () => {
  test('accepts only a valid SHA-256 signature over the exact payload bytes', () => {
    const payload = new TextEncoder().encode('{"ref":"refs/heads/main"}')
    const secret = 'webhook-secret'
    const signature = `sha256=${createHmac('sha256', secret).update(payload).digest('hex')}`

    expect(verifyGitHubSignature(payload, signature, secret)).toBe(true)
    expect(
      verifyGitHubSignature(payload, `${signature.slice(0, -1)}0`, secret),
    ).toBe(false)
    expect(verifyGitHubSignature(payload, null, secret)).toBe(false)
    expect(verifyGitHubSignature(payload, 'sha1=invalid', secret)).toBe(false)
  })
})

describe('GitHub repository matching', () => {
  test('normalizes supported GitHub clone URLs', () => {
    expect(githubRepositorySlug('https://github.com/Acme/Service.git')).toBe(
      'acme/service',
    )
    expect(githubRepositorySlug('git@github.com:Acme/Service.git')).toBe(
      'acme/service',
    )
    expect(githubRepositorySlug('ssh://git@github.com/Acme/Service.git')).toBe(
      'acme/service',
    )
  })

  test('rejects lookalike hosts and non-repository paths', () => {
    expect(
      githubRepositorySlug('https://evilgithub.com/acme/service'),
    ).toBeNull()
    expect(githubRepositorySlug('https://github.com/acme')).toBeNull()
  })
})

describe('GitHub scan targeting', () => {
  const base = '1'.repeat(40)
  const head = '2'.repeat(40)

  test('turns branch pushes into committed diff scans', () => {
    expect(
      parseGitHubScanEvent('push', {
        ref: 'refs/heads/main',
        before: base,
        after: head,
        repository: { full_name: 'Acme/Service' },
      }),
    ).toEqual({
      status: 'scan',
      slug: 'acme/service',
      branch: 'main',
      target: { kind: 'diff', base, head },
    })
  })

  test('uses repository scope for the first push on a new branch', () => {
    const result = parseGitHubScanEvent('push', {
      ref: 'refs/heads/main',
      before: '0'.repeat(40),
      after: head,
      repository: { full_name: 'Acme/Service' },
    })
    expect(result).toMatchObject({
      status: 'scan',
      target: { kind: 'repository' },
    })
  })

  test('targets the base-to-head diff for reviewable pull requests', () => {
    expect(
      parseGitHubScanEvent('pull_request', {
        action: 'synchronize',
        pull_request: {
          draft: false,
          base: {
            ref: 'main',
            sha: base,
            repo: { full_name: 'Acme/Service' },
          },
          head: { sha: head },
        },
      }),
    ).toEqual({
      status: 'scan',
      slug: 'acme/service',
      branch: 'main',
      target: { kind: 'diff', base, head },
    })
  })

  test('ignores drafts, deletions, and non-scan pull request actions', () => {
    expect(
      parseGitHubScanEvent('push', {
        ref: 'refs/heads/main',
        before: base,
        after: '0'.repeat(40),
        deleted: true,
        repository: { full_name: 'Acme/Service' },
      }),
    ).toMatchObject({ status: 'ignored' })
    expect(
      parseGitHubScanEvent('pull_request', {
        action: 'opened',
        pull_request: {
          draft: true,
          base: {
            ref: 'main',
            sha: base,
            repo: { full_name: 'Acme/Service' },
          },
          head: { sha: head },
        },
      }),
    ).toMatchObject({ status: 'ignored' })
    expect(
      parseGitHubScanEvent('pull_request', {
        action: 'closed',
        pull_request: {
          base: {
            ref: 'main',
            sha: base,
            repo: { full_name: 'Acme/Service' },
          },
          head: { sha: head },
        },
      }),
    ).toMatchObject({ status: 'ignored' })
  })
})
