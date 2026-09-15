import { describe, expect, test } from 'bun:test'
import { createKeyedLock } from '@/lib/keyed-lock'

describe('keyed lock', () => {
  test('serializes tasks for the same key', async () => {
    const withLock = createKeyedLock<number>()
    const events: string[] = []
    let releaseFirst: () => void = () => {}
    const firstCanFinish = new Promise<void>((resolve) => {
      releaseFirst = resolve
    })

    const first = withLock(7, async () => {
      events.push('first started')
      await firstCanFinish
      events.push('first finished')
    })
    const second = withLock(7, async () => {
      events.push('second started')
    })

    await Promise.resolve()
    expect(events).toEqual(['first started'])
    releaseFirst()
    await Promise.all([first, second])
    expect(events).toEqual([
      'first started',
      'first finished',
      'second started',
    ])
  })

  test('allows different keys to run concurrently', async () => {
    const withLock = createKeyedLock<number>()
    let active = 0
    let peak = 0

    const task = (key: number) =>
      withLock(key, async () => {
        active += 1
        peak = Math.max(peak, active)
        await Promise.resolve()
        active -= 1
      })

    await Promise.all([task(1), task(2)])
    expect(peak).toBe(2)
  })

  test('releases the key when a task fails', async () => {
    const withLock = createKeyedLock<number>()
    const failed = withLock(7, async () => {
      throw new Error('failed')
    })
    const recovered = withLock(7, async () => 'recovered')

    expect(failed).rejects.toThrow('failed')
    expect(await recovered).toBe('recovered')
  })
})
