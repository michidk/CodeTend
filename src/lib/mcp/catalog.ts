import { z } from 'zod'

export const MCP_SCOPE_VALUES = ['codetend:read', 'codetend:write'] as const

export const mcpScopeSchema = z.enum(MCP_SCOPE_VALUES)
export type McpScope = z.infer<typeof mcpScopeSchema>

export const MCP_SCOPE_DETAILS: Record<
  McpScope,
  { label: string; description: string }
> = {
  'codetend:read': {
    label: 'Read code health',
    description:
      'Inspect repositories, scans, findings, and repository knowledge.',
  },
  'codetend:write': {
    label: 'Control scans',
    description: 'Start and cancel repository scans.',
  },
}

export const MCP_TOOL_CATALOG = [
  {
    name: 'list_repositories',
    title: 'List repositories',
    description: 'List repositories tracked by CodeTend.',
    group: 'Read',
    scope: 'codetend:read',
  },
  {
    name: 'get_repository',
    title: 'Get repository health',
    description:
      'Inspect a repository, its recent scans, knowledge, and findings.',
    group: 'Read',
    scope: 'codetend:read',
  },
  {
    name: 'list_scans',
    title: 'List scans',
    description:
      'List recent scans, optionally filtered by repository and status.',
    group: 'Read',
    scope: 'codetend:read',
  },
  {
    name: 'get_scan',
    title: 'Get scan details',
    description: 'Inspect one scan, its scanner runs, and bounded findings.',
    group: 'Read',
    scope: 'codetend:read',
  },
  {
    name: 'get_finding',
    title: 'Get finding details',
    description:
      'Inspect one finding with evidence, history, validation, and patches.',
    group: 'Read',
    scope: 'codetend:read',
  },
  {
    name: 'trigger_scan',
    title: 'Trigger scan',
    description: 'Queue a default scan for a tracked repository.',
    group: 'Control scans',
    scope: 'codetend:write',
  },
  {
    name: 'cancel_scan',
    title: 'Cancel scan',
    description: 'Request cancellation of a queued or running scan.',
    group: 'Control scans',
    scope: 'codetend:write',
  },
] as const satisfies ReadonlyArray<{
  name: string
  title: string
  description: string
  group: 'Read' | 'Control scans'
  scope: McpScope
}>

export type McpToolName = (typeof MCP_TOOL_CATALOG)[number]['name']
export const MCP_TOOL_NAMES = MCP_TOOL_CATALOG.map((tool) => tool.name) as [
  McpToolName,
  ...McpToolName[],
]
export const mcpToolNameSchema = z.enum(MCP_TOOL_NAMES)

export function scopesForEnabledTools(disabledTools: readonly string[]) {
  const disabled = new Set(disabledTools)
  return MCP_SCOPE_VALUES.filter(
    (scope) =>
      scope === 'codetend:read' ||
      MCP_TOOL_CATALOG.some(
        (tool) => tool.scope === scope && !disabled.has(tool.name),
      ),
  )
}
