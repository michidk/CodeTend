import { CircleHelp } from 'lucide-react'
import type { ReactNode } from 'react'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'

export function PageHelp({
  children,
  ariaLabel = 'About this page',
}: {
  readonly children: ReactNode
  readonly ariaLabel?: string
}) {
  return (
    <Popover>
      <PopoverTrigger
        aria-label={ariaLabel}
        className="flex size-9 shrink-0 items-center justify-center rounded-full border-2 border-ink bg-candy-grape text-ink shadow-toy-sm transition-transform duration-200 ease-spring hover:-translate-y-0.5 hover:rotate-12 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/60 focus-visible:ring-offset-2 focus-visible:ring-offset-background motion-reduce:transition-none [@media(pointer:coarse)]:size-11"
        openOnHover
        delay={0}
        closeDelay={100}
      >
        <CircleHelp aria-hidden="true" className="size-5" />
      </PopoverTrigger>
      <PopoverContent
        className="w-72 text-sm font-medium leading-relaxed text-foreground"
        side="bottom"
        sideOffset={6}
      >
        {children}
      </PopoverContent>
    </Popover>
  )
}
