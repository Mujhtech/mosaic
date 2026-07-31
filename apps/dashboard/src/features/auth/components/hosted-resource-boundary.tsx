import { CopyIcon } from "@phosphor-icons/react/dist/ssr/Copy"
import { Link } from "@tanstack/react-router"
import { useState } from "react"
import type { ReactNode } from "react"

import { EmptyState } from "@/components/feedback/empty-state"
import { ErrorState } from "@/components/feedback/error-state"
import { LoadingState } from "@/components/feedback/loading-state"
import { Button } from "@/components/ui/button"
import { buttonVariants } from "@/components/ui/button-variants"
import { HostedAccessBanner } from "@/features/auth/components/hosted-access-banner"

export type HostedResourceState =
  | { kind: "decision_required" }
  | { description?: string; kind: "loading"; title?: string }
  | { description: string; kind: "empty"; title: string; action?: ReactNode }
  | { description?: string; kind: "error"; requestId?: string; onRetry?: () => void }
  | { action?: ReactNode; description: string; kind: "permission"; requiredRole?: string }
  | { kind: "ready" }

interface HostedResourceBoundaryProps {
  children: ReactNode
  state: HostedResourceState
}

export function HostedResourceBoundary({ children, state }: HostedResourceBoundaryProps) {
  switch (state.kind) {
    case "decision_required":
      return <HostedAccessBanner />
    case "loading":
      return <LoadingState description={state.description} title={state.title} />
    case "empty":
      return (
        <EmptyState action={state.action} description={state.description} title={state.title} />
      )
    case "error":
      return <HostedErrorState state={state} />
    case "permission":
      return (
        <section
          aria-labelledby="permission-title"
          className="border-border bg-muted/30 rounded border p-6"
        >
          <p className="text-muted-foreground text-xs font-semibold tracking-wide uppercase">
            Permission required
          </p>
          <h2 className="mt-2 text-lg font-semibold" id="permission-title">
            You do not have permission for this cloud resource
          </h2>
          <p className="text-muted-foreground mt-2 max-w-2xl text-sm leading-6">
            {state.description}
            {state.requiredRole ? ` Required role: ${state.requiredRole}.` : ""}
          </p>
          {state.action ? <div className="mt-5">{state.action}</div> : null}
        </section>
      )
    case "ready":
      return children
  }
}

function HostedErrorState({ state }: { state: Extract<HostedResourceState, { kind: "error" }> }) {
  const [copied, setCopied] = useState(false)

  async function copyRequestId() {
    if (!state.requestId) return
    await navigator.clipboard.writeText(state.requestId)
    setCopied(true)
  }

  return (
    <div className="space-y-3">
      <ErrorState
        description={
          state.description ??
          "Mosaic could not load this hosted resource. Your local Studio work is unchanged."
        }
        onRetry={state.onRetry}
        retryLabel="Retry"
        title="Cloud workspace unavailable"
      />
      <div className="flex flex-wrap items-center gap-2">
        <Link className={buttonVariants({ variant: "outline" })} to="/studio">
          Continue locally
        </Link>
        {state.requestId ? (
          <Button onClick={() => void copyRequestId()} variant="ghost">
            <CopyIcon aria-hidden size={16} />
            {copied ? "Request ID copied" : "Copy request ID"}
          </Button>
        ) : null}
      </div>
    </div>
  )
}
