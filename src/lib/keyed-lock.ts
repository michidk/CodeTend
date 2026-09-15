export function createKeyedLock<Key>() {
  const tails = new Map<Key, Promise<void>>()

  return async function withLock<Result>(
    key: Key,
    task: () => Promise<Result>,
  ): Promise<Result> {
    const previous = tails.get(key) ?? Promise.resolve()
    let release: () => void = () => {}
    const current = new Promise<void>((resolve) => {
      release = resolve
    })
    const tail = previous.then(() => current)
    tails.set(key, tail)

    await previous
    try {
      return await task()
    } finally {
      release()
      if (tails.get(key) === tail) tails.delete(key)
    }
  }
}
