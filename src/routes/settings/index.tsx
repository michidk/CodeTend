import { createFileRoute, Link } from '@tanstack/react-router'
import { Page, PageHeader } from '@/components/page-layout'
import { RouteError } from '@/components/route-error'
import { DetailPending } from '@/components/route-pending'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { getScheduleSettings } from '@/lib/server/schedule-settings'
import { ScheduleSettingsForm } from './-components/schedule-settings-form'

export const Route = createFileRoute('/settings/')({
  loader: async () => {
    return { schedule: await getScheduleSettings() }
  },
  component: SettingsPage,
  pendingComponent: DetailPending,
  errorComponent: ({ error }) => <RouteError error={error} />,
})

function SettingsPage() {
  const { schedule } = Route.useLoaderData()
  return (
    <Page width="form">
      <PageHeader
        title="Settings"
        description="Control scan and fix-agent queues, execution profiles, investigation budgets, and AI cost limits."
        size="compact"
      />
      <ScheduleSettingsForm settings={schedule} />
      <Card>
        <CardHeader>
          <CardTitle>AI access (MCP)</CardTitle>
          <p className="text-sm text-muted-foreground">
            Connect Codex or another MCP client to inspect code health and, when
            permitted, control scans.
          </p>
        </CardHeader>
        <CardContent>
          <Button variant="outline" render={<Link to="/settings/mcp" />}>
            Manage AI access
          </Button>
        </CardContent>
      </Card>
    </Page>
  )
}
