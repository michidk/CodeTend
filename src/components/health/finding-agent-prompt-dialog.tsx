import { Bot } from 'lucide-react'
import { useState } from 'react'
import { CopyButton } from '@/components/copy-button'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

export function FindingAgentPromptDialog({
  prompt,
}: {
  readonly prompt: string
}) {
  const [open, setOpen] = useState(false)

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button
        type="button"
        size="sm"
        variant="outline"
        onClick={() => setOpen(true)}
      >
        <Bot className="size-3.5" aria-hidden="true" />
        Fix locally
      </Button>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Fix with your local agent</DialogTitle>
          <DialogDescription>
            Copy this prompt and paste it into a coding agent working in your
            local checkout.
          </DialogDescription>
        </DialogHeader>
        <DialogBody>
          <pre className="select-text whitespace-pre-wrap break-words rounded-xl border border-border bg-muted p-4 text-xs leading-relaxed">
            <code>{prompt}</code>
          </pre>
        </DialogBody>
        <DialogFooter showCloseButton>
          <CopyButton text={prompt} label="Copy prompt" />
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
