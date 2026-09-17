import { createServerFn } from '@tanstack/react-start'
import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '@/db'
import { globalScannerSettings } from '@/db/schema'
import { REASONING_EFFORTS } from '@/lib/agent-execution'
import { DomainError, expectReturnedRow } from '@/lib/domain-errors'
import {
  customScannerSchema,
  resolveScannerConfigurations,
} from '@/lib/scanner-configuration'
import { getScanner, type ScannerDefinition } from '@/lib/scanners'

export async function listGlobalScanners(): Promise<ScannerDefinition[]> {
  const rows = await db.query.globalScannerSettings.findMany({
    orderBy: (table, { asc }) => [asc(table.createdAt), asc(table.scannerId)],
  })
  return resolveScannerConfigurations(rows)
}

export const getGlobalScanners = createServerFn({ method: 'GET' }).handler(
  listGlobalScanners,
)

export const setGlobalScannerEnabled = createServerFn({ method: 'POST' })
  .validator(
    z.object({
      scannerId: z.string().min(1).max(60),
      enabled: z.boolean(),
    }),
  )
  .handler(async ({ data }) => {
    const existing = await db.query.globalScannerSettings.findFirst({
      where: eq(globalScannerSettings.scannerId, data.scannerId),
    })
    if (!existing && !getScanner(data.scannerId)) {
      throw new DomainError('not_found', 'Scanner not found')
    }

    const [updated] = await db
      .insert(globalScannerSettings)
      .values({
        scannerId: data.scannerId,
        enabled: data.enabled,
        definition: existing?.definition ?? null,
      })
      .onConflictDoUpdate({
        target: globalScannerSettings.scannerId,
        set: { enabled: data.enabled, updatedAt: new Date() },
      })
      .returning()
    return expectReturnedRow(updated, 'Scanner setting')
  })

export const setGlobalScannerExecutionProfile = createServerFn({
  method: 'POST',
})
  .validator(
    z.object({
      scannerId: z.string().min(1).max(60),
      model: z.string().trim().max(200).nullable(),
      effort: z.enum(REASONING_EFFORTS).nullable(),
    }),
  )
  .handler(async ({ data }) => {
    const existing = await db.query.globalScannerSettings.findFirst({
      where: eq(globalScannerSettings.scannerId, data.scannerId),
    })
    if (!existing && !getScanner(data.scannerId)) {
      throw new DomainError('not_found', 'Scanner not found')
    }
    const [updated] = await db
      .insert(globalScannerSettings)
      .values({
        scannerId: data.scannerId,
        enabled:
          existing?.enabled ?? getScanner(data.scannerId)?.enabled ?? true,
        definition: existing?.definition ?? null,
        model: data.model || null,
        effort: data.effort,
      })
      .onConflictDoUpdate({
        target: globalScannerSettings.scannerId,
        set: {
          model: data.model || null,
          effort: data.effort,
          updatedAt: new Date(),
        },
      })
      .returning()
    return expectReturnedRow(updated, 'Scanner setting')
  })

export const createCustomScanner = createServerFn({ method: 'POST' })
  .validator(customScannerSchema)
  .handler(async ({ data }) => {
    if (getScanner(data.id)) {
      throw new DomainError('conflict', 'That scanner id is reserved.')
    }
    try {
      const [created] = await db
        .insert(globalScannerSettings)
        .values({ scannerId: data.id, enabled: true, definition: data })
        .returning()
      return expectReturnedRow(created, 'Custom scanner')
    } catch (error) {
      if (postgresErrorCode(error) === '23505') {
        throw new DomainError(
          'conflict',
          'A scanner with that id already exists.',
        )
      }
      throw error
    }
  })

export const deleteCustomScanner = createServerFn({ method: 'POST' })
  .validator(z.string().min(1).max(60))
  .handler(async ({ data: scannerId }) => {
    const existing = await db.query.globalScannerSettings.findFirst({
      where: eq(globalScannerSettings.scannerId, scannerId),
    })
    if (!existing?.definition) {
      throw new DomainError('conflict', 'Built-in scanners cannot be removed.')
    }
    await db
      .delete(globalScannerSettings)
      .where(eq(globalScannerSettings.scannerId, scannerId))
    return { scannerId }
  })

function postgresErrorCode(error: unknown): string | undefined {
  let current: unknown = error
  for (let depth = 0; depth < 4; depth += 1) {
    if (typeof current !== 'object' || current === null) return undefined
    const record = current as { code?: unknown; cause?: unknown }
    if (typeof record.code === 'string') return record.code
    current = record.cause
  }
  return undefined
}
