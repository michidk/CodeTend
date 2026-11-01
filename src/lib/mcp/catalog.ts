import { z } from 'zod'

export const MCP_TOOL_CATALOG = [
  {
    name: 'list_repositories',
    title: 'List repositories',
    description: 'List repositories tracked by CodeTend.',
    group: 'Read',
  },
  {
    name: 'get_repository',
    title: 'Get repository health',
    description:
      'Inspect a repository, its recent scans, knowledge, and findings.',
    group: 'Read',
  },
  {
    name: 'list_scans',
    title: 'List scans',
    description:
      'List recent scans, optionally filtered by repository and status.',
    group: 'Read',
  },
  {
    name: 'get_scan',
    title: 'Get scan details',
    description: 'Inspect one scan, its scanner runs, and bounded findings.',
    group: 'Read',
  },
  {
    name: 'get_finding',
    title: 'Get finding details',
    description:
      'Inspect one finding with evidence, history, validation, and patches.',
    group: 'Read',
  },
  {
    name: 'generate_fix_prompt',
    title: 'Generate fix prompt',
    description:
      "Generate a coding-agent prompt from a scanner's current open findings.",
    group: 'Read',
  },
  {
    name: 'register_repository',
    title: 'Register repository',
    description: 'Start tracking a Git repository.',
    group: 'Manage repositories',
  },
  {
    name: 'trigger_scan',
    title: 'Trigger scan',
    description: 'Queue a default scan for a tracked repository.',
    group: 'Control scans',
  },
  {
    name: 'cancel_scan',
    title: 'Cancel scan',
    description: 'Request cancellation of a queued or running scan.',
    group: 'Control scans',
  },
  {
    name: 'mark_finding_fixed',
    title: 'Mark finding fixed',
    description:
      'Resolve a finding as operator-reported fixed with required context.',
    group: 'Manage findings',
  },
  {
    name: 'mark_finding_false_positive',
    title: 'Mark finding false positive',
    description: 'Resolve a finding as a false positive with optional context.',
    group: 'Manage findings',
  },
  {
    name: 'accept_finding_risk',
    title: 'Accept finding risk',
    description: 'Resolve a finding as an accepted risk with required context.',
    group: 'Manage findings',
  },
  {
    name: 'reopen_finding',
    title: 'Reopen finding',
    description: 'Remove a manual disposition and return a finding to active.',
    group: 'Manage findings',
  },
] as const satisfies ReadonlyArray<{
  name: string
  title: string
  description: string
  group: 'Read' | 'Manage repositories' | 'Control scans' | 'Manage findings'
}>

export type McpToolName = (typeof MCP_TOOL_CATALOG)[number]['name']
export const MCP_TOOL_NAMES = MCP_TOOL_CATALOG.map((tool) => tool.name) as [
  McpToolName,
  ...McpToolName[],
]
export const mcpToolNameSchema = z.enum(MCP_TOOL_NAMES)
