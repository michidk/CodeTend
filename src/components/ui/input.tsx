import { Input as InputPrimitive } from '@base-ui/react/input'
import type * as React from 'react'

import { cn } from '@/lib/utils'

function Input({ className, type, ...props }: React.ComponentProps<'input'>) {
  return (
    <InputPrimitive
      type={type}
      data-slot="input"
      className={cn(
        'h-12 w-full min-w-0 rounded-2xl border-[3px] border-ink bg-card px-4 py-1 text-base font-semibold shadow-toy-inset transition-[color,background-color,border-color,box-shadow,transform] duration-150 outline-none file:inline-flex file:h-6 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:font-medium placeholder:text-muted-foreground focus-visible:bg-card focus-visible:shadow-toy-sm focus-visible:ring-3 focus-visible:ring-ring/60 focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:cursor-not-allowed disabled:bg-muted disabled:shadow-none disabled:opacity-60 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/30 md:text-sm [@media(hover:hover)_and_(pointer:fine)]:h-11',
        className,
      )}
      {...props}
    />
  )
}

export { Input }
