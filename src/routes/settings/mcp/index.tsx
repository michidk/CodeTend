import { createFileRoute } from '@tanstack/react-router'
import { Page, PageHeader } from '@/components/page-layout'
import { RouteError } from '@/components/route-error'
import { DetailPending } from '@/components/route-pending'
import { getMcpAdminState } from '@/lib/mcp/settings'
import { McpSettingsPage } from './-components/mcp-settings-page'

export const Route = createFileRoute('/settings/mcp/')({
  loader: () => getMcpAdminState(),
  head: () => ({ meta: [{ title: 'AI access · CodeTend' }] }),
  component: McpSettingsRoute,
  pendingComponent: DetailPending,
  errorComponent: ({ error }) => <RouteError error={error} />,
})

function McpSettingsRoute() {
  const state = Route.useLoaderData()
  return (
    <Page width="wide">
      <PageHeader
        title="AI access"
        description="Control exactly what connected assistants can read or change through the Model Context Protocol. OAuth scopes and per-tool switches are enforced on every request."
        size="compact"
      />
      <McpSettingsPage state={state} />
    </Page>
  )
}
