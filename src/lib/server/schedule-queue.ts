import { createServerFn } from '@tanstack/react-start'
import { scheduleEditsSchema } from '@/lib/schedule-edits'
import { ensureScheduleSettingsRow } from '@/lib/server/schedule-settings'

export const getScheduleQueue = createServerFn({ method: 'GET' }).handler(
  async () => {
    const { loadScheduleCandidates } = await import('./schedule-queue.server')
    const [candidates, settings] = await Promise.all([
      loadScheduleCandidates(),
      ensureScheduleSettingsRow(),
    ])
    return { ...candidates, settings }
  },
)

export const saveScheduleQueue = createServerFn({ method: 'POST' })
  .validator(scheduleEditsSchema)
  .handler(async ({ data }) => {
    const { saveScheduleQueueImpl } = await import('./schedule-queue.server')
    return saveScheduleQueueImpl(data)
  })
