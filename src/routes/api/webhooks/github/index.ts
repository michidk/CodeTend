import { createFileRoute } from '@tanstack/react-router'
import { handleGitHubWebhook } from '@/lib/server/github-webhook'

export const Route = createFileRoute('/api/webhooks/github/')({
  server: {
    handlers: {
      POST: ({ request }) => handleGitHubWebhook(request),
    },
  },
})
