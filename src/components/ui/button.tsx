import { Button as ButtonPrimitive } from '@base-ui/react/button'
import { cva, type VariantProps } from 'class-variance-authority'
import * as React from 'react'

import { cn } from '@/lib/utils'

const buttonVariants = cva(
  "inline-flex shrink-0 items-center justify-center gap-2 rounded-full border-[3px] border-ink font-display text-sm font-semibold whitespace-nowrap transition-[color,background-color,border-color,box-shadow,transform] duration-150 ease-spring outline-none hover:-translate-y-0.5 focus-visible:ring-[3px] focus-visible:ring-ring/60 focus-visible:ring-offset-2 focus-visible:ring-offset-background active:translate-x-[3px] active:translate-y-[3px] active:shadow-none disabled:pointer-events-none disabled:translate-y-0 disabled:opacity-50 aria-invalid:border-destructive motion-reduce:transition-none [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default:
          'bg-primary text-primary-foreground shadow-toy-sm hover:bg-candy-sun hover:shadow-toy disabled:shadow-toy-sm',
        primary:
          'bg-primary text-primary-foreground shadow-toy-sm hover:bg-candy-sun hover:shadow-toy disabled:shadow-toy-sm',
        destructive:
          'bg-destructive text-white shadow-toy-sm hover:bg-candy-pink hover:text-ink hover:shadow-toy focus-visible:ring-destructive/40 disabled:shadow-toy-sm',
        outline:
          'bg-card text-foreground shadow-toy-sm hover:bg-secondary hover:shadow-toy disabled:shadow-toy-sm',
        secondary:
          'bg-candy-sky text-ink shadow-toy-sm hover:bg-accent hover:shadow-toy disabled:shadow-toy-sm',
        ghost:
          'border-transparent text-muted-foreground hover:translate-y-0 hover:border-ink hover:bg-card hover:text-foreground hover:shadow-toy-sm',
        link: 'rounded-none border-transparent text-link underline-offset-4 hover:translate-y-0 hover:text-foreground hover:underline active:translate-x-0 active:translate-y-0',
      },
      size: {
        default:
          'h-11 px-5 py-2 has-[>svg]:px-4 [@media(hover:hover)_and_(pointer:fine)]:h-10',
        xs: "h-11 gap-1 px-2.5 text-xs has-[>svg]:px-2 [@media(hover:hover)_and_(pointer:fine)]:h-7 [&_svg:not([class*='size-'])]:size-3",
        sm: 'h-11 gap-1.5 px-3.5 text-[13px] has-[>svg]:px-3 [@media(hover:hover)_and_(pointer:fine)]:h-9',
        lg: 'h-13 px-7 text-base has-[>svg]:px-5',
        icon: 'size-11 [@media(hover:hover)_and_(pointer:fine)]:size-10',
        'icon-xs':
          "size-11 [@media(hover:hover)_and_(pointer:fine)]:size-7 [&_svg:not([class*='size-'])]:size-3",
        'icon-sm': 'size-11 [@media(hover:hover)_and_(pointer:fine)]:size-9',
        'icon-lg': 'size-13',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
)

function Button({
  className,
  variant = 'default',
  size = 'default',
  asChild = false,
  render,
  nativeButton,
  role,
  children,
  ...props
}: ButtonPrimitive.Props &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean
  }) {
  const child = asChild && React.isValidElement(children) ? children : undefined

  return (
    <ButtonPrimitive
      data-slot="button"
      data-variant={variant}
      data-size={size}
      className={cn(buttonVariants({ variant, size, className }))}
      nativeButton={asChild ? false : nativeButton}
      render={child ?? render}
      role={role ?? (asChild ? 'link' : undefined)}
      {...props}
    >
      {children}
    </ButtonPrimitive>
  )
}

export { Button, buttonVariants }
