import { z } from 'zod'
import type { ReasoningEffort } from '@/lib/agent-execution'
import { getScanner, SCANNERS, type ScannerDefinition } from '@/lib/scanners'

const scannerIdSchema = z
  .string()
  .trim()
  .min(2)
  .max(60)
  .regex(
    /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
    'Use lowercase letters, numbers, and single hyphens.',
  )

export const customScannerSchema = z.object({
  id: scannerIdSchema,
  name: z.string().trim().min(2).max(100),
  shortName: z.string().trim().min(2).max(40),
  description: z.string().trim().min(10).max(500),
  weight: z.number().min(0.1).max(10),
  prompt: z.string().trim().min(20).max(20_000),
  fixPromptTitle: z.string().trim().min(2).max(120),
  fixGuidance: z.string().trim().max(10_000).optional(),
})

export type CustomScannerDefinition = z.infer<typeof customScannerSchema>

export interface StoredScannerConfiguration {
  readonly scannerId: string
  readonly enabled: boolean
  readonly definition: CustomScannerDefinition | null
  readonly model?: string | null
  readonly effort?: ReasoningEffort | null
}

/** Merges code-owned built-ins with persisted enable overrides and customs. */
export function resolveScannerConfigurations(
  rows: readonly StoredScannerConfiguration[],
): ScannerDefinition[] {
  const byId = new Map(rows.map((row) => [row.scannerId, row]))
  const builtIns = SCANNERS.map((scanner) => ({
    ...scanner,
    enabled: byId.get(scanner.id)?.enabled ?? scanner.enabled,
    model: byId.get(scanner.id)?.model ?? null,
    effort: byId.get(scanner.id)?.effort ?? null,
  }))
  const customs = rows.flatMap((row): ScannerDefinition[] => {
    if (!row.definition || getScanner(row.scannerId)) return []
    const parsed = customScannerSchema.safeParse(row.definition)
    if (!parsed.success || parsed.data.id !== row.scannerId) return []
    return [
      {
        ...parsed.data,
        kind: 'agent',
        enabled: row.enabled,
        custom: true,
        model: row.model,
        effort: row.effort,
      },
    ]
  })
  return [...builtIns, ...customs]
}
