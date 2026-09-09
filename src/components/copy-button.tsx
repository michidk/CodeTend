import type { VariantProps } from 'class-variance-authority'
import { Check, Copy } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { Button, type buttonVariants } from '@/components/ui/button'

export function CopyButton({
  text,
  label = 'Copy',
  copiedLabel = 'Copied',
  size = 'default',
  variant = 'default',
  className,
}: {
  readonly text: string
  readonly label?: string
  readonly copiedLabel?: string
  readonly size?: VariantProps<typeof buttonVariants>['size']
  readonly variant?: VariantProps<typeof buttonVariants>['variant']
  readonly className?: string
}) {
  const [copied, setCopied] = useState(false)

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      toast.success('Copied to clipboard')
      window.setTimeout(() => setCopied(false), 2000)
    } catch {
      toast.error('Could not copy. Select the text and copy it manually.')
    }
  }

  return (
    <Button
      type="button"
      size={size}
      variant={variant}
      className={className}
      onClick={() => void copy()}
    >
      {copied ? (
        <Check className="size-4" aria-hidden="true" />
      ) : (
        <Copy className="size-4" aria-hidden="true" />
      )}
      {copied ? copiedLabel : label}
    </Button>
  )
}
