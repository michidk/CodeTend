import { z } from 'zod'

export const scheduleEditsSchema = z
  .object({
    changes: z
      .array(
        z.object({
          repositoryId: z.number().int().positive(),
          position: z
            .number()
            .finite()
            .min(-1e12)
            .max(1e12)
            .refine(
              (value) => !Number.isInteger(value),
              'Manual ranks must be between automatic ranks',
            )
            .nullable(),
          expectedPosition: z.number().nullable(),
          expectedUpdatedAt: z.iso.datetime().nullable(),
          lastScanAt: z.iso.datetime().nullable(),
        }),
      )
      .min(1)
      .max(1_000),
  })
  .refine(
    ({ changes }) =>
      new Set(changes.map((row) => row.repositoryId)).size === changes.length,
    'Duplicate repository changes',
  )

export type ScheduleEdits = z.infer<typeof scheduleEditsSchema>
