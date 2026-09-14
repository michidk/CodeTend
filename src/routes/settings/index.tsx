import { createFileRoute } from '@tanstack/react-router'
import { Page, PageHeader } from '@/components/page-layout'
import { RouteError } from '@/components/route-error'
import { DetailPending } from '@/components/route-pending'
import { getScheduleSettings } from '@/lib/server/schedule-settings'
import { ScheduleSettingsForm } from './-components/schedule-settings-form'

export const Route = createFileRoute('/settings/')({
  loader: () => getScheduleSettings(),
  component: SettingsPage,
  pendingComponent: DetailPending,
  errorComponent: ({ error }) => <RouteError error={error} />,
})

function SettingsPage() {
  const settings = Route.useLoaderData()
  return (
    <Page width="form">
      <PageHeader
        title="Settings"
        description="Control the shared repository scan queue, its source-file filter and review budget, and how quickly it dispatches work."
        size="compact"
      />
      <ScheduleSettingsForm settings={settings} />
    </Page>
  )
}
