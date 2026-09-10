import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'

const positiveId = z.number().int().positive()

export const generateFindingPatch = createServerFn({ method: 'POST' })
  .validator(positiveId)
  .handler(async ({ data: findingId }) => {
    const { generateFindingPatchImpl } = await import(
      '@/lib/server/finding-patches.server'
    )
    return generateFindingPatchImpl(findingId)
  })

export const decideFindingPatch = createServerFn({ method: 'POST' })
  .validator(
    z.object({
      patchId: positiveId,
      decision: z.enum(['accepted', 'rejected']),
    }),
  )
  .handler(async ({ data }) => {
    const { decideFindingPatchImpl } = await import(
      '@/lib/server/finding-patches.server'
    )
    return decideFindingPatchImpl(data)
  })

export const getFindingPatchDownload = createServerFn({ method: 'GET' })
  .validator(positiveId)
  .handler(async ({ data: patchId }) => {
    const { getFindingPatch } = await import(
      '@/lib/server/finding-patches.server'
    )
    return getFindingPatch(patchId)
  })
