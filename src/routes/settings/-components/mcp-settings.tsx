import { useState } from 'react'
import { Button } from '@/components/ui/button'
import type { McpToolName } from '@/lib/mcp/catalog'
import { revokeMcpClientConnection, updateMcpPolicy } from '@/lib/mcp/settings'

type State = Awaited<
  ReturnType<typeof import('@/lib/mcp/settings').getMcpAdminState>
>

export function McpSettings({ initialState }: { initialState: State }) {
  const [state, setState] = useState(initialState)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  async function save(enabled: boolean, disabledTools: McpToolName[]) {
    setSaving(true)
    setMessage(null)
    try {
      const policy = await updateMcpPolicy({ data: { enabled, disabledTools } })
      setState((current) => ({ ...current, policy }))
      setMessage('MCP access settings saved.')
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : 'Saving MCP settings failed',
      )
    } finally {
      setSaving(false)
    }
  }

  async function revoke(clientId: string) {
    if (!window.confirm('Revoke this MCP client and all of its tokens?')) return
    await revokeMcpClientConnection({ data: { clientId } })
    setState((current) => ({
      ...current,
      clients: current.clients.map((client) =>
        client.id === clientId
          ? {
              ...client,
              revokedAt: new Date().toISOString(),
              activeTokenCount: 0,
            }
          : client,
      ),
    }))
  }

  const disabled = new Set(state.policy.disabledTools)
  const groups = state.tools.reduce<Record<string, typeof state.tools>>(
    (result, tool) => {
      const groupTools = result[tool.group] ?? []
      groupTools.push(tool)
      result[tool.group] = groupTools
      return result
    },
    {},
  )

  return (
    <section className="space-y-5 rounded-2xl border border-border bg-card p-5 shadow-card sm:p-6">
      <div className="space-y-1">
        <h2 className="font-display text-xl font-bold">AI access (MCP)</h2>
        <p className="text-sm text-muted-foreground">
          Connect Codex or another MCP client to inspect code health and, when
          permitted, control scans.
        </p>
      </div>

      <div className="rounded-xl border border-border bg-muted/30 p-4 text-sm">
        <p className="font-semibold">Endpoint</p>
        <code className="mt-1 block break-all text-xs">
          {state.endpoint ??
            state.configurationError ??
            'MCP is not configured'}
        </code>
      </div>

      <label className="flex items-start justify-between gap-4 rounded-xl border border-border p-4">
        <span>
          <span className="block font-semibold">Enable MCP access</span>
          <span className="text-sm text-muted-foreground">
            Pausing access rejects protocol and token requests immediately.
          </span>
        </span>
        <input
          type="checkbox"
          aria-label="Enable MCP access"
          className="mt-1 size-5"
          checked={state.policy.enabled}
          disabled={saving}
          onChange={(event) =>
            void save(event.target.checked, state.policy.disabledTools)
          }
        />
      </label>

      {Object.entries(groups).map(([group, tools]) => (
        <div key={group} className="space-y-2">
          <h3 className="font-semibold">{group}</h3>
          {tools.map((tool) => (
            <label
              key={tool.name}
              className="flex items-start gap-3 rounded-lg border border-border p-3"
            >
              <input
                type="checkbox"
                aria-label={`Enable ${tool.title}`}
                className="mt-1 size-4"
                checked={!disabled.has(tool.name)}
                disabled={saving}
                onChange={(event) => {
                  const next = new Set(state.policy.disabledTools)
                  if (event.target.checked) next.delete(tool.name)
                  else next.add(tool.name)
                  void save(state.policy.enabled, [...next])
                }}
              />
              <span>
                <span className="block text-sm font-semibold">
                  {tool.title}
                </span>
                <span className="text-sm text-muted-foreground">
                  {tool.description}
                </span>
              </span>
            </label>
          ))}
        </div>
      ))}

      <div className="space-y-3">
        <h3 className="font-semibold">Connected clients</h3>
        {state.clients.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No MCP clients have connected yet.
          </p>
        ) : (
          state.clients.map((client) => (
            <div
              key={client.id}
              className="flex items-center justify-between gap-4 rounded-lg border border-border p-3"
            >
              <div className="min-w-0 text-sm">
                <p className="truncate font-semibold">{client.name}</p>
                <p className="text-xs text-muted-foreground">
                  {client.revokedAt
                    ? 'Revoked'
                    : `${client.activeTokenCount} active token${client.activeTokenCount === 1 ? '' : 's'}`}
                </p>
              </div>
              {!client.revokedAt && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => void revoke(client.id)}
                >
                  Revoke
                </Button>
              )}
            </div>
          ))
        )}
      </div>

      {message && <p className="text-sm text-muted-foreground">{message}</p>}
    </section>
  )
}
