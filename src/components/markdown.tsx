import type { ComponentProps } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { cn } from '@/lib/utils'

/**
 * Renders model-authored markdown (knowledge overviews, finding text) with the
 * app's typography. Raw HTML is not rendered, and links open in a new tab.
 */
export function Markdown({
  children,
  className,
  compact = false,
}: {
  readonly children: string
  readonly className?: string
  /** Tighter spacing for text inside cards and lists. */
  readonly compact?: boolean
}) {
  return (
    <div
      className={cn(
        'markdown min-w-0 break-words leading-relaxed',
        compact ? 'markdown-compact' : 'markdown-document',
        className,
      )}
    >
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {children}
      </ReactMarkdown>
    </div>
  )
}

const components: ComponentProps<typeof ReactMarkdown>['components'] = {
  a: ({ node: _node, ...props }) => (
    <a
      {...props}
      target="_blank"
      rel="noreferrer"
      className="font-bold text-link underline decoration-2 underline-offset-2 hover:text-foreground"
    />
  ),
  pre: ({ node: _node, ...props }) => (
    <pre
      {...props}
      className="overflow-x-auto rounded-2xl border-[3px] border-ink bg-muted p-3 text-xs leading-relaxed shadow-toy-inset"
    />
  ),
  table: ({ node: _node, ...props }) => (
    <div className="overflow-x-auto">
      <table {...props} className="w-full text-left text-sm" />
    </div>
  ),
}
