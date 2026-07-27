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
import type { ApiErrorDetailEntry, ApiErrorRecovery } from "@/lib/api/errors"

interface HostedResourceFailure {
  description?: string
  details?: ApiErrorDetailEntry[]
  onRetry?: () => void
  recovery?: ApiErrorRecovery
  requestId?: string
}

export type HostedResourceState =
  | { kind: "decision_required" }
  | { description?: string; kind: "loading"; title?: string }
  | { description: string; kind: "empty"; title: string; action?: ReactNode }
  | (HostedResourceFailure & { kind: "error" })
  | (HostedResourceFailure & { kind: "degraded" })
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
    case "degraded":
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

function HostedErrorState({
  state,
}: {
  state: Extract<HostedResourceState, { kind: "degraded" | "error" }>
}) {
  const degraded = state.kind === "degraded"

  return (
    <div className="space-y-3">
      <ErrorState
        description={
          state.description ??
          "Mosaic could not load this hosted resource. Your local Studio work is unchanged."
        }
        onRetry={state.onRetry}
        retryLabel="Retry"
        title={degraded ? "Mosaic API unreachable" : "Cloud workspace unavailable"}
      />
      <ApiErrorDetails details={state.details} />
      <div className="flex flex-wrap items-center gap-2">
        {state.recovery ? <ApiErrorRecoveryAction recovery={state.recovery} /> : null}
        <Link className={buttonVariants({ variant: "outline" })} to="/studio">
          Continue locally
        </Link>
      </div>
      {state.requestId ? <RequestIdCopy requestId={state.requestId} /> : null}
    </div>
  )
}

/**
 * Server-supplied specifics for a coded failure: readiness blockers, rejected
 * fields, the refused precondition. These are Mosaic-owned codes and resource
 * identifiers, never server prose.
 */
export function ApiErrorDetails({ details }: { details?: ApiErrorDetailEntry[] }) {
  if (!details || details.length === 0) return null

  return (
    <dl className="border-border bg-muted/30 space-y-1 rounded border p-3 text-sm">
      {details.map((entry) => (
        <div className="flex flex-wrap gap-x-2" key={`${entry.label ?? ""}:${entry.value}`}>
          {entry.label ? (
            <dt className="text-muted-foreground font-medium">{entry.label}</dt>
          ) : (
            <dt className="sr-only">Detail</dt>
          )}
          <dd className="font-mono text-xs break-all">{entry.value}</dd>
        </div>
      ))}
    </dl>
  )
}

/**
 * The single next step for a coded failure. A recovery without a destination
 * would be a dead control, so the link renders only when the surrounding view
 * supplied the identifiers the destination needs.
 */
export function ApiErrorRecoveryAction({ recovery }: { recovery: ApiErrorRecovery }) {
  if (!recovery.href) return null

  return (
    <a className={buttonVariants({ variant: "default" })} href={recovery.href}>
      {recovery.label}
    </a>
  )
}

/**
 * Clipboard access is unavailable outside secure contexts and in some
 * browsers, so the identifier always stays selectable as a manual fallback.
 */
export function RequestIdCopy({ requestId }: { requestId: string }) {
  const [copied, setCopied] = useState(false)
  const [failed, setFailed] = useState(false)

  const canCopy =
    typeof navigator !== "undefined" && typeof navigator.clipboard?.writeText === "function"

  async function copyRequestId() {
    try {
      await navigator.clipboard.writeText(requestId)
      setCopied(true)
      setFailed(false)
    } catch {
      setFailed(true)
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-muted-foreground text-xs">
        Request ID:{" "}
        <code className="bg-muted rounded px-1 py-0.5 font-mono select-all">{requestId}</code>
      </span>
      {canCopy ? (
        <Button onClick={() => void copyRequestId()} size="sm" variant="ghost">
          <CopyIcon aria-hidden size={16} />
          {copied ? "Request ID copied" : "Copy request ID"}
        </Button>
      ) : null}
      <span aria-live="polite" className="text-muted-foreground text-xs">
        {failed ? "Copying failed. Select the request ID above to copy it manually." : ""}
      </span>
    </div>
  )
}
