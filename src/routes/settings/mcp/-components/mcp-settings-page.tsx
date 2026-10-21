import { useRouter } from '@tanstack/react-router'
import {
  Activity,
  Bot,
  ChevronLeft,
  ChevronRight,
  KeyRound,
  ShieldCheck,
  Trash2,
} from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { CopyButton } from '@/components/copy-button'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Switch } from '@/components/ui/switch'
import { getErrorMessage } from '@/lib/error-message'
import { formatDateTime } from '@/lib/format'
import type { McpToolName } from '@/lib/mcp/catalog'
import {
  type getMcpAdminState,
  getMcpAuditPage,
  revokeMcpClientConnection,
  updateMcpPolicy,
} from '@/lib/mcp/settings'
import { cn } from '@/lib/utils'

type McpAdminState = Awaited<ReturnType<typeof getMcpAdminState>>

function SummaryCard({
  icon: Icon,
  label,
  value,
  mono,
}: {
  icon: typeof Bot
  label: string
  value: string
  mono?: boolean
}) {
  return (
    <Card>
      <CardHeader className="flex-row items-center gap-3">
        <Icon className="text-primary" size={22} aria-hidden="true" />
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {label}
          </p>
          <CardTitle className={cn('mt-1', mono && 'font-mono')}>
            {value}
          </CardTitle>
        </div>
      </CardHeader>
    </Card>
  )
}

export function McpSettingsPage({ state }: { state: McpAdminState }) {
  const router = useRouter()
  const [enabled, setEnabled] = useState(state.policy.enabled)
  const [disabledTools, setDisabledTools] = useState(
    () => new Set<McpToolName>(state.policy.disabledTools),
  )
  const [saving, setSaving] = useState(false)
  const [showRevoked, setShowRevoked] = useState(false)
  const [audit, setAudit] = useState(state.audit)
  const [auditLoading, setAuditLoading] = useState(false)

  const activeClients = state.clients.filter((client) => !client.revokedAt)
  const revokedCount = state.clients.length - activeClients.length
  const visibleClients = showRevoked ? state.clients : activeClients
  const dirty =
    enabled !== state.policy.enabled ||
    disabledTools.size !== state.policy.disabledTools.length ||
    state.policy.disabledTools.some((tool) => !disabledTools.has(tool))

  const auditPages = Math.max(1, Math.ceil(audit.total / audit.pageSize))
  const auditFirst = audit.total === 0 ? 0 : audit.page * audit.pageSize + 1
  const auditLast = Math.min(audit.total, (audit.page + 1) * audit.pageSize)

  const groups = [...new Set(state.tools.map((tool) => tool.group))].map(
    (group) => ({
      group,
      tools: state.tools.filter((tool) => tool.group === group),
    }),
  )

  async function loadAuditPage(page: number) {
    setAuditLoading(true)
    try {
      setAudit(await getMcpAuditPage({ data: { page } }))
    } catch (error) {
      toast.error(getErrorMessage(error, 'Loading activity failed'))
    } finally {
      setAuditLoading(false)
    }
  }

  function toggleTool(tool: McpToolName, checked: boolean) {
    setDisabledTools((current) => {
      const next = new Set(current)
      if (checked) next.delete(tool)
      else next.add(tool)
      return next
    })
  }

  async function save() {
    setSaving(true)
    try {
      await updateMcpPolicy({
        data: { enabled, disabledTools: [...disabledTools] },
      })
      await router.invalidate()
      toast.success('AI access saved. New requests use it immediately.')
    } catch (error) {
      toast.error(getErrorMessage(error, 'Saving AI access failed'))
    } finally {
      setSaving(false)
    }
  }

  async function revoke(clientId: string, name: string) {
    if (
      !window.confirm(
        `Revoke MCP access for “${name}”? Its tokens will stop working immediately.`,
      )
    ) {
      return
    }
    try {
      await revokeMcpClientConnection({ data: { clientId } })
      await router.invalidate()
      toast.success(`${name} was revoked`)
    } catch (error) {
      toast.error(getErrorMessage(error, 'Revoking the client failed'))
    }
  }

  return (
    <div className="space-y-8">
      <div className="grid gap-4 md:grid-cols-3">
        <SummaryCard
          icon={Bot}
          label="Server"
          value={
            !state.configured
              ? 'Not configured'
              : state.policy.enabled
                ? 'Available'
                : 'Paused'
          }
        />
        <SummaryCard
          icon={KeyRound}
          label="Clients"
          value={String(activeClients.length)}
          mono
        />
        <SummaryCard
          icon={ShieldCheck}
          label="Enabled tools"
          value={`${state.tools.length - state.policy.disabledTools.length}/${state.tools.length}`}
          mono
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Connection</CardTitle>
          <p className="text-sm leading-6 text-muted-foreground">
            CodeTend serves MCP at its own public origin. Use this URL in your
            AI client; no separate MCP service or URL setting is required.
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          {state.endpoint ? (
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
              <code className="min-w-0 flex-1 overflow-x-auto rounded-xl bg-muted px-4 py-3 font-mono text-sm">
                {state.endpoint}
              </code>
              <CopyButton
                text={state.endpoint}
                label="Copy URL"
                variant="outline"
              />
            </div>
          ) : (
            <p className="rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
              {state.configurationError ?? 'MCP is not configured'}
            </p>
          )}

          <label
            htmlFor="mcp-enabled"
            className="flex min-h-16 items-center justify-between gap-4 rounded-xl border border-border p-4"
          >
            <span>
              <span className="block font-semibold">Enable MCP access</span>
              <span className="mt-1 block text-sm text-muted-foreground">
                Pausing rejects protocol and OAuth requests without deleting
                clients or audit history.
              </span>
            </span>
            <Switch
              id="mcp-enabled"
              checked={enabled}
              onCheckedChange={setEnabled}
            />
          </label>
        </CardContent>
      </Card>

      <section aria-labelledby="tools-heading">
        <div className="mb-4">
          <h2 id="tools-heading" className="text-xl font-semibold">
            Available tools
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Disabled tools disappear from MCP discovery. OAuth scopes provide a
            second, client-specific permission boundary.
          </p>
        </div>
        <div className="grid gap-5 lg:grid-cols-3">
          {groups.map(({ group, tools }) => (
            <Card key={group}>
              <CardHeader>
                <div className="flex items-center justify-between gap-3">
                  <CardTitle>{group}</CardTitle>
                  <Badge
                    variant={
                      tools[0]?.scope.endsWith(':read') ? 'default' : 'outline'
                    }
                  >
                    {tools[0]?.scope.endsWith(':read') ? 'read' : 'write'}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent>
                <div className="divide-y divide-border">
                  {tools.map((tool) => (
                    <label
                      key={tool.name}
                      htmlFor={`mcp-tool-${tool.name}`}
                      className="flex min-h-16 items-start justify-between gap-3 py-3"
                    >
                      <span className="min-w-0">
                        <span className="block text-sm font-semibold">
                          {tool.title}
                        </span>
                        <span className="mt-1 block text-xs leading-5 text-muted-foreground">
                          {tool.description}
                        </span>
                        <code className="mt-1 block truncate font-mono text-xs text-primary">
                          {tool.name}
                        </code>
                      </span>
                      <Switch
                        id={`mcp-tool-${tool.name}`}
                        className="mt-0.5"
                        checked={!disabledTools.has(tool.name)}
                        onCheckedChange={(checked) =>
                          toggleTool(tool.name, checked)
                        }
                      />
                    </label>
                  ))}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
        <div className="mt-5">
          <Button
            type="button"
            disabled={saving || !dirty}
            onClick={() => void save()}
          >
            {saving ? 'Saving…' : 'Save AI access'}
          </Button>
        </div>
      </section>

      <section aria-labelledby="clients-heading">
        <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 id="clients-heading" className="text-xl font-semibold">
              Connected clients
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Revoking a client invalidates all of its access and refresh tokens
              immediately.
            </p>
          </div>
          {revokedCount > 0 ? (
            <label
              htmlFor="mcp-show-revoked"
              className="flex items-center gap-2 text-sm text-muted-foreground"
            >
              <Switch
                id="mcp-show-revoked"
                checked={showRevoked}
                onCheckedChange={setShowRevoked}
              />
              Show {revokedCount} revoked
            </label>
          ) : null}
        </div>
        {state.clients.length === 0 ? (
          <Card className="p-6 text-sm text-muted-foreground">
            No MCP clients have connected yet.
          </Card>
        ) : visibleClients.length === 0 ? (
          <Card className="p-6 text-sm text-muted-foreground">
            Every client is revoked. Enable “Show {revokedCount} revoked” to see
            them.
          </Card>
        ) : (
          <Card className="overflow-hidden">
            <ul className="divide-y divide-border">
              {visibleClients.map((client) => (
                <li
                  key={client.id}
                  className={cn(
                    'flex flex-wrap items-center gap-x-3 gap-y-1.5 px-4 py-3',
                    client.revokedAt && 'bg-muted/35',
                  )}
                >
                  <span className="min-w-0 flex-1 truncate font-medium">
                    {client.name}
                  </span>
                  {client.scopes.map((scope) => (
                    <Badge
                      key={scope}
                      variant="outline"
                      className="font-mono text-xs"
                    >
                      {scope.replace('codetend:', '')}
                    </Badge>
                  ))}
                  <Badge variant={client.revokedAt ? 'secondary' : 'default'}>
                    {client.revokedAt
                      ? 'Revoked'
                      : `${client.activeTokenCount} token${client.activeTokenCount === 1 ? '' : 's'}`}
                  </Badge>
                  <span className="whitespace-nowrap font-mono text-xs text-muted-foreground">
                    {formatDateTime(client.createdAt)}
                  </span>
                  {client.revokedAt ? (
                    <span className="w-20" />
                  ) : (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="w-20 text-destructive"
                      onClick={() => void revoke(client.id, client.name)}
                    >
                      <Trash2 size={15} aria-hidden="true" /> Revoke
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          </Card>
        )}
      </section>

      <section aria-labelledby="activity-heading">
        <div className="mb-4 flex items-center gap-2.5">
          <Activity className="text-primary" size={20} aria-hidden="true" />
          <h2 id="activity-heading" className="text-xl font-semibold">
            Recent activity
          </h2>
        </div>
        <Card className="overflow-hidden">
          {audit.total === 0 ? (
            <p className="p-6 text-sm text-muted-foreground">
              No MCP activity yet.
            </p>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[40rem] text-left text-sm">
                  <thead className="border-b border-border bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
                    <tr>
                      <th className="px-5 py-3">Time</th>
                      <th className="px-5 py-3">Event</th>
                      <th className="px-5 py-3">Tool</th>
                      <th className="px-5 py-3">Outcome</th>
                    </tr>
                  </thead>
                  <tbody
                    className={cn(
                      'divide-y divide-border',
                      auditLoading && 'opacity-60',
                    )}
                  >
                    {audit.events.map((event) => (
                      <tr key={event.id}>
                        <td className="whitespace-nowrap px-5 py-3 font-mono text-xs">
                          {formatDateTime(event.createdAt)}
                        </td>
                        <td className="px-5 py-3 capitalize">
                          {event.event.replaceAll('_', ' ')}
                        </td>
                        <td className="px-5 py-3 font-mono text-xs">
                          {event.toolName ?? '—'}
                        </td>
                        <td className="px-5 py-3">
                          <Badge
                            variant={
                              event.outcome === 'success'
                                ? 'default'
                                : event.outcome === 'denied'
                                  ? 'secondary'
                                  : 'destructive'
                            }
                          >
                            {event.outcome}
                          </Badge>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {auditPages > 1 ? (
                <div className="flex items-center justify-between gap-3 border-t border-border px-5 py-3">
                  <p
                    aria-live="polite"
                    className="text-xs text-muted-foreground"
                  >
                    {auditFirst}–{auditLast} of {audit.total}
                  </p>
                  <div className="flex gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={audit.page === 0 || auditLoading}
                      onClick={() => void loadAuditPage(audit.page - 1)}
                    >
                      <ChevronLeft size={15} aria-hidden="true" /> Newer
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={audit.page + 1 >= auditPages || auditLoading}
                      onClick={() => void loadAuditPage(audit.page + 1)}
                    >
                      Older <ChevronRight size={15} aria-hidden="true" />
                    </Button>
                  </div>
                </div>
              ) : null}
            </>
          )}
        </Card>
      </section>
    </div>
  )
}
