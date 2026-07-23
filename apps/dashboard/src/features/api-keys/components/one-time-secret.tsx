import { CopyIcon } from "@phosphor-icons/react/dist/ssr/Copy"
import { XIcon } from "@phosphor-icons/react/dist/ssr/X"
import { useState } from "react"

import { Button } from "@/components/ui/button"

interface OneTimeSecretProps {
  onDismiss: () => void
  secret: string
  writeToClipboard?: (value: string) => Promise<void>
}

export function OneTimeSecret({
  onDismiss,
  secret,
  writeToClipboard = (value) => navigator.clipboard.writeText(value),
}: OneTimeSecretProps) {
  const [copied, setCopied] = useState(false)

  async function copySecret() {
    await writeToClipboard(secret)
    setCopied(true)
  }

  return (
    <section
      aria-labelledby="secret-title"
      className="border-primary/30 bg-primary/5 rounded border p-5"
      role="status"
    >
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold tracking-wide uppercase">One-time secret</p>
          <h2 className="mt-1 text-lg font-semibold" id="secret-title">
            Copy this key now
          </h2>
          <p className="text-muted-foreground mt-1 text-sm">
            Mosaic cannot show this secret again after you dismiss it.
          </p>
        </div>
        <Button
          aria-label="Dismiss one-time secret"
          onClick={onDismiss}
          size="icon"
          variant="ghost"
        >
          <XIcon aria-hidden size={17} />
        </Button>
      </div>
      <code className="bg-background mt-4 block overflow-x-auto rounded border p-3 text-sm">
        {secret}
      </code>
      <Button className="mt-3" onClick={() => void copySecret()} variant="outline">
        <CopyIcon aria-hidden size={16} />
        {copied ? "Copied" : "Copy secret"}
      </Button>
    </section>
  )
}
