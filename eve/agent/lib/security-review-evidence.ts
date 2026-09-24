import { z } from 'zod'

export const inspectedEvidenceSchema = z.object({
  path: z
    .string()
    .min(1)
    .max(1_000)
    .refine(
      (path) =>
        !path.startsWith('/') &&
        !path.startsWith('\\') &&
        !path.split(/[\\/]/).includes('..'),
      'Evidence paths must be repository-relative and may not traverse upward.',
    ),
  startLine: z.number().int().positive().optional(),
  endLine: z.number().int().positive().optional(),
  symbol: z.string().min(1).max(200).optional(),
  role: z.enum(['source', 'control', 'sink', 'supporting', 'test']),
  summary: z.string().min(5).max(1_000),
})

export type InspectedEvidence = z.infer<typeof inspectedEvidenceSchema>

export function confirmReviewEvidence(
  evidence: readonly InspectedEvidence[],
  repositoryFiles: readonly string[],
): {
  readonly confirmed: boolean
  readonly validEvidence: InspectedEvidence[]
} {
  const availableFiles = new Set(repositoryFiles.map(normalizePath))
  const validEvidence = evidence.filter((entry) =>
    availableFiles.has(normalizePath(entry.path)),
  )
  return {
    validEvidence,
    confirmed:
      validEvidence.some((entry) => entry.role === 'source') &&
      validEvidence.some((entry) => entry.role === 'sink'),
  }
}

function normalizePath(path: string): string {
  return path.replaceAll('\\', '/').replace(/^\.\//, '')
}
