import { defineDynamic, defineMcpClientConnection } from 'eve/connections'

/**
 * Optional GitNexus code-intelligence layer. The tecdebt app starts the
 * GitNexus MCP HTTP server (loopback) and sets GITNEXUS_MCP_URL for the Eve
 * runtime; when unset the connection simply does not exist and agents fall
 * back to filesystem search. Read-only tools only.
 */
export function gitnexusConnection() {
  return defineDynamic({
    events: {
      'session.started': () => {
        const url = process.env.GITNEXUS_MCP_URL
        if (!url) return null
        return defineMcpClientConnection({
          url,
          description:
            'GitNexus code intelligence for the repository under analysis: symbol search, callers/callees, execution flows, clusters, impact analysis and import cycles. Pass the repo name given in the task.',
          tools: {
            allow: [
              'query',
              'context',
              'impact',
              'trace',
              'check',
              'cypher',
              'list_repos',
              'route_map',
            ],
          },
        })
      },
    },
  })
}
