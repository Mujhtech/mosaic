import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { dashboardBuildInfo, dashboardEnvironment } from "@/config/environment";
import { RequestIdCopy } from "@/features/auth/components/hosted-resource-boundary";
import { sessionQueryOptions } from "@/features/auth/queries/session-query";
import { apiHealthQueryOptions } from "@/features/diagnostics/queries/api-health-query";
import { ApiError, describeApiError } from "@/lib/api/errors";

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid gap-0.5 py-2 sm:grid-cols-[14rem_1fr] sm:gap-4">
      <dt className="font-medium text-muted-foreground text-xs">{label}</dt>
      <dd className="break-all font-mono text-xs">{value}</dd>
    </div>
  );
}

/**
 * Everything an operator needs to answer "which dashboard am I looking at, and
 * what is it talking to". Mosaic reports no client errors anywhere by design,
 * so this panel plus the correlation identifier is the whole support path.
 */
export function DiagnosticsPanel() {
  const session = useQuery(sessionQueryOptions());
  const health = useQuery({ ...apiHealthQueryOptions(), enabled: false });

  let sessionState = "Unknown";
  if (session.isPending && session.fetchStatus !== "idle") {
    sessionState = "Checking…";
  } else if (session.isSuccess) {
    sessionState = `Signed in as ${session.data.email}`;
  } else if (
    session.error instanceof ApiError &&
    session.error.status === 401
  ) {
    sessionState = "Not signed in";
  } else if (session.error) {
    sessionState = describeApiError(session.error).description;
  }

  let healthState = "Not probed yet";
  if (health.isFetching) {
    healthState = "Probing…";
  } else if (health.isSuccess) {
    healthState = `Reachable (status ${health.data.status})`;
  } else if (health.isError) {
    healthState = describeApiError(health.error).description;
  }

  // Health is asked first because probing it is the deliberate act; a stale
  // session error should not shadow the identifier for the probe just run.
  const failed =
    health.error instanceof ApiError ? health.error : session.error;
  const correlationId =
    failed instanceof ApiError ? failed.correlationId : undefined;

  return (
    <section
      aria-labelledby="diagnostics-title"
      className="rounded border border-border p-5"
    >
      <h2 className="font-semibold text-base" id="diagnostics-title">
        Dashboard diagnostics
      </h2>
      <p className="mt-1 text-muted-foreground text-sm leading-6">
        Quote these values when reporting a problem. Mosaic does not send
        browser errors anywhere.
      </p>

      <dl className="mt-4 divide-y">
        <Row label="Dashboard version" value={dashboardBuildInfo.version} />
        <Row label="Commit" value={dashboardBuildInfo.commit} />
        <Row label="Built at" value={dashboardBuildInfo.builtAt} />
        <Row label="API base URL" value={dashboardEnvironment.apiBaseUrl} />
        <Row
          label="Preview relay URL"
          value={dashboardEnvironment.previewUrl}
        />
        <Row label="Session state" value={sessionState} />
        <Row label="API liveness" value={healthState} />
        {/* Identity of the artifact actually serving the API. Only rendered
            once a probe has answered, so the rows never imply a value Mosaic
            has not observed. */}
        {health.isSuccess ? (
          <>
            <Row
              label="API version"
              value={health.data.version ?? "Not reported"}
            />
            <Row
              label="API commit"
              value={health.data.commit ?? "Not reported"}
            />
            <Row
              label="API built at"
              value={health.data.built ?? "Not reported"}
            />
          </>
        ) : null}
      </dl>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <Button
          disabled={health.isFetching}
          onClick={() => {
            health.refetch();
          }}
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
  );
}
