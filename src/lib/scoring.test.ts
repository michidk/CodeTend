import { describe, expect, test } from 'bun:test'
import {
  CONFIDENCE_FACTOR,
  calculateOverallScore,
  calculateScannerScore,
  findingPenalty,
  gradeForScore,
  SEVERITY_PENALTY,
} from '@/lib/scoring'

describe('scanner score', () => {
  test('starts at 100 with no findings', () => {
    expect(calculateScannerScore([])).toBe(100)
  })

  test('subtracts severity penalty scaled by confidence', () => {
    expect(findingPenalty({ severity: 'critical', confidence: 'high' })).toBe(
      SEVERITY_PENALTY.critical * CONFIDENCE_FACTOR.high,
    )
    expect(findingPenalty({ severity: 'high', confidence: 'medium' })).toBe(
      16 * 0.8,
    )
    expect(
      calculateScannerScore([
        { severity: 'high', confidence: 'high' },
        { severity: 'medium', confidence: 'low' },
        { severity: 'low', confidence: 'medium' },
      ]),
    ).toBe(100 - 16 - 4 - 2.4)
  })

  test('never drops below zero and rounds to one decimal', () => {
    const critical = { severity: 'critical', confidence: 'high' } as const
    expect(calculateScannerScore(Array(5).fill(critical))).toBe(0)
    expect(
      calculateScannerScore([{ severity: 'low', confidence: 'medium' }]),
    ).toBe(97.6)
  })
})

describe('overall score', () => {
  const scanner = (id: string, weight: number) => ({ id, weight })

  test('is null when no scanner produced a score', () => {
    expect(calculateOverallScore([])).toBeNull()
    expect(
      calculateOverallScore([{ scanner: scanner('a', 1), score: null }]),
    ).toBeNull()
  })

  test('weights scanner scores and ignores scanners without a result', () => {
    expect(
      calculateOverallScore([
        { scanner: scanner('a', 3), score: 90 },
        { scanner: scanner('b', 1), score: 50 },
        { scanner: scanner('c', 10), score: null },
      ]),
    ).toBe(80)
  })
})

describe('grades', () => {
  test('follow the documented thresholds', () => {
    expect(gradeForScore(100)).toBe('A')
    expect(gradeForScore(90)).toBe('A')
    expect(gradeForScore(89.9)).toBe('B')
    expect(gradeForScore(75)).toBe('B')
    expect(gradeForScore(60)).toBe('C')
    expect(gradeForScore(40)).toBe('D')
    expect(gradeForScore(39.9)).toBe('F')
    expect(gradeForScore(0)).toBe('F')
  })

  test('is null without a score', () => {
    expect(gradeForScore(null)).toBeNull()
  })
})
