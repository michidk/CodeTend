import { createFileRoute } from '@tanstack/react-router'
import { Page, PageHeader } from '@/components/page-layout'
import { RouteError } from '@/components/route-error'
import { DetailPending } from '@/components/route-pending'
import { getMcpAdminState } from '@/lib/mcp/settings'
import { getScheduleSettings } from '@/lib/server/schedule-settings'
import { McpSettings } from './-components/mcp-settings'
import { ScheduleSettingsForm } from './-components/schedule-settings-form'

export const Route = createFileRoute('/settings/')({
  loader: async () => {
    const [schedule, mcp] = await Promise.all([
      getScheduleSettings(),
      getMcpAdminState(),
    ])
    return { schedule, mcp }
  },
  component: SettingsPage,
  pendingComponent: DetailPending,
  errorComponent: ({ error }) => <RouteError error={error} />,
})

function SettingsPage() {
  const { schedule, mcp } = Route.useLoaderData()
  return (
    <Page width="form">
      <PageHeader
        title="Settings"
        description="Control the shared repository scan queue, investigation budget, AI cost limits, and dispatch rate."
        size="compact"
      />
      <ScheduleSettingsForm settings={schedule} />
      <McpSettings initialState={mcp} />
    </Page>
  )
}
