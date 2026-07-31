import { useQuery } from "@tanstack/react-query"

import { RequestIdCopy } from "@/features/auth/components/hosted-resource-boundary"
import { Button } from "@/components/ui/button"
import { dashboardBuildInfo, dashboardEnvironment } from "@/config/environment"
import { apiHealthQueryOptions } from "@/features/diagnostics/queries/api-health-query"
import { sessionQueryOptions } from "@/features/auth/queries/session-query"
import { ApiError, describeApiError } from "@/lib/api/errors"

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid gap-0.5 py-2 sm:grid-cols-[14rem_1fr] sm:gap-4">
      <dt className="text-muted-foreground text-xs font-medium">{label}</dt>
      <dd className="font-mono text-xs break-all">{value}</dd>
    </div>
  )
}

/**
 * Everything an operator needs to answer "which dashboard am I looking at, and
 * what is it talking to". Mosaic reports no client errors anywhere by design,
 * so this panel plus the correlation identifier is the whole support path.
 */
export function DiagnosticsPanel() {
  const session = useQuery(sessionQueryOptions())
  const health = useQuery({ ...apiHealthQueryOptions(), enabled: false })

  const sessionState =
    session.isPending && session.fetchStatus !== "idle"
      ? "Checking…"
      : session.isSuccess
        ? `Signed in as ${session.data.email}`
        : session.error instanceof ApiError && session.error.status === 401
          ? "Not signed in"
          : session.error
            ? describeApiError(session.error).description
            : "Unknown"

  const healthState = health.isFetching
    ? "Probing…"
    : health.isSuccess
      ? `Reachable (status ${health.data.status})`
      : health.isError
        ? describeApiError(health.error).description
        : "Not probed yet"

  const correlationId =
    health.error instanceof ApiError
      ? health.error.correlationId
      : session.error instanceof ApiError
        ? session.error.correlationId
        : undefined

  return (
    <section aria-labelledby="diagnostics-title" className="border-border rounded border p-5">
      <h2 className="text-base font-semibold" id="diagnostics-title">
        Dashboard diagnostics
      </h2>
      <p className="text-muted-foreground mt-1 text-sm leading-6">
        Quote these values when reporting a problem. Mosaic does not send browser errors anywhere.
      </p>

      <dl className="mt-4 divide-y">
        <Row label="Dashboard version" value={dashboardBuildInfo.version} />
        <Row label="Commit" value={dashboardBuildInfo.commit} />
        <Row label="Built at" value={dashboardBuildInfo.builtAt} />
        <Row label="API base URL" value={dashboardEnvironment.apiBaseUrl} />
        <Row label="Preview relay URL" value={dashboardEnvironment.previewUrl} />
        <Row label="Session state" value={sessionState} />
        <Row label="API liveness" value={healthState} />
        {/* Identity of the artifact actually serving the API. Only rendered
            once a probe has answered, so the rows never imply a value Mosaic
            has not observed. */}
        {health.isSuccess ? (
          <>
            <Row label="API version" value={health.data.version ?? "Not reported"} />
            <Row label="API commit" value={health.data.commit ?? "Not reported"} />
            <Row label="API built at" value={health.data.built ?? "Not reported"} />
          </>
        ) : null}
      </dl>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <Button
          disabled={health.isFetching}
          onClick={() => void health.refetch()}
          size="sm"
          type="button"
          variant="outline"
        >
          {health.isFetching ? "Probing API…" : "Probe API health"}
        </Button>
      </div>
      {correlationId ? (
        <div className="mt-3">
          <RequestIdCopy requestId={correlationId} />
        </div>
      ) : null}
    </section>
  )
}
