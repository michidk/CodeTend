import { describe, expect, test } from 'bun:test'
import { validateRepositoryLocation } from './repository-access'

const hosted = {
  allowedHosts: ['github.com'],
  allowLocal: false,
  allowInsecureHttp: false,
}

describe('repository access policy', () => {
  test('accepts credential-free HTTPS and SCP-style SSH on allowed hosts', () => {
    expect(
      validateRepositoryLocation('https://github.com/acme/service.git', hosted),
    ).toBeNull()
    expect(
      validateRepositoryLocation('git@github.com:acme/service.git', hosted),
    ).toBeNull()
  })

  test('rejects alternate hosts, plaintext transport and embedded credentials', () => {
    expect(
      validateRepositoryLocation('https://internal.example/repo.git', hosted),
    ).toContain('not allowed')
    expect(
      validateRepositoryLocation('http://github.com/acme/service.git', hosted),
    ).toContain('Plain HTTP')
    expect(
      validateRepositoryLocation(
        'https://token@github.com/acme/service.git',
        hosted,
      ),
    ).toContain('credentials')
  })

  test('allows local repositories only when explicitly enabled', () => {
    expect(validateRepositoryLocation('/srv/repos/service', hosted)).toContain(
      'disabled',
    )
    expect(
      validateRepositoryLocation('/srv/repos/service', {
        ...hosted,
        allowLocal: true,
      }),
    ).toBeNull()
  })
})
