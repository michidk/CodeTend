import { expect, test } from 'bun:test'
import {
  applySchedulePositions,
  getScheduleMovePosition,
} from './schedule-order'

const entries = [1, 2, 3, 4].map((id) => ({
  id,
  position: null as number | null,
}))

function move(rows: typeof entries, id: number, index: number) {
  const position = getScheduleMovePosition(rows, id, index)
  return rows.map((row) => (row.id === id ? { ...row, position } : row))
}

test('leaves automatic order unchanged without overrides', () => {
  expect(applySchedulePositions(entries).map((x) => x.id)).toEqual([1, 2, 3, 4])
})

test('only moved entries have saved keys and automatic relative order is preserved', () => {
  const changed = move(entries, 4, 1)
  expect(applySchedulePositions(changed).map((x) => x.id)).toEqual([1, 4, 2, 3])
  expect(changed.filter((x) => x.position !== null).map((x) => x.id)).toEqual([
    4,
  ])
  expect(entries.every((x) => x.position === null)).toBe(true)
})

test('repeated moves preserve intervening effects without saving shifted rows', () => {
  let changed = move(entries, 1, 1)
  changed = move(changed, 3, 1)
  expect(applySchedulePositions(changed).map((x) => x.id)).toEqual([2, 3, 1, 4])
  changed = move(changed, 1, 3)
  expect(applySchedulePositions(changed).map((x) => x.id)).toEqual([2, 3, 4, 1])
  expect(changed.filter((x) => x.position !== null).map((x) => x.id)).toEqual([
    1, 3,
  ])
})

test('moving an existing override keeps the other overrides in displayed order', () => {
  let changed = move(entries, 1, 1)
  changed = move(changed, 2, 1)
  expect(applySchedulePositions(changed).map((x) => x.id)).toEqual([1, 2, 3, 4])
})

test('manual keys never collide with automatic ranks', () => {
  let changed = entries
  for (let i = 0; i < 20; i++) {
    changed = move(changed, 4, i % 2)
    const position = changed.find((x) => x.id === 4)?.position
    expect(position).toBeNumber()
    expect(Number.isInteger(position)).toBe(false)
  }
})

test('automatic order can change while overrides retain their relative rank', () => {
  const changed = move(entries, 4, 1)
  expect(
    applySchedulePositions(
      [changed[2], changed[0], changed[1], changed[3]].filter(
        (x) => x !== undefined,
      ),
    ).map((x) => x.id),
  ).toEqual([3, 4, 1, 2])
})

test('resetting or consuming an override restores automatic ordering', () => {
  const changed = move(entries, 4, 0)
  expect(
    applySchedulePositions(changed.map((x) => ({ ...x, position: null }))).map(
      (x) => x.id,
    ),
  ).toEqual([1, 2, 3, 4])
  expect(applySchedulePositions([])).toEqual([])
})
