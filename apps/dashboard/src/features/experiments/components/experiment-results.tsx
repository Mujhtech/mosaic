import { useQuery } from "@tanstack/react-query";
import { ErrorState } from "@/components/feedback/error-state";
import { LoadingState } from "@/components/feedback/loading-state";
import { WorkflowPanel } from "@/features/orgs/components/workspace-page";
import { useExperimentAdapter } from "../api/use-experiment-adapter";
import { experimentResultsQueryOptions } from "../queries/experiment-queries";
import {
  describeMetricEventFilter,
  type ExperimentScope,
} from "../types/experiment";
import { ExperimentIssueCard } from "./experiment-status";

const MATURITY_ISSUE = /sample|fresh|matur|srm|ratio/i;

function percent(value: number) {
  return new Intl.NumberFormat(undefined, {
    style: "percent",
    maximumFractionDigits: 2,
  }).format(value);
}

export function ExperimentResultsPanel({
  experimentId,
  scope,
}: {
  experimentId: string;
  scope: ExperimentScope;
}) {
  const adapter = useExperimentAdapter();
  const query = useQuery(
    experimentResultsQueryOptions(scope, experimentId, adapter)
  );

  if (query.isPending) {
    return (
      <LoadingState
        description="Loading unique-unit results and uncertainty."
        title="Loading results"
      />
    );
  }
  if (query.error) {
    return (
      <ErrorState
        description={query.error.message}
        onRetry={() => {
          query.refetch();
        }}
      />
    );
  }
  const results = query.data;
  const doNotInterpret =
    results.interim ||
    !results.attributionWindowMature ||
    results.freshnessMinutes === undefined ||
    results.srm.status !== "ok" ||
    results.issues.some((issue) =>
      MATURITY_ISSUE.test(`${issue.code} ${issue.title} ${issue.message}`)
    );
  return (
    <div className="grid gap-5">
      {doNotInterpret ? (
        <div
          className="rounded border border-amber-600/35 bg-amber-500/5 p-4"
          role="alert"
        >
          <p className="font-semibold text-sm">Do not interpret yet</p>
          <p className="mt-1 text-muted-foreground text-sm">
            Results are descriptive while sample ratio, sample size, freshness,
            or the attribution window is unresolved. Investigate the warnings
            and wait for mature, fresh aggregates before making a decision.
          </p>
        </div>
      ) : null}
      <div
        className="rounded border border-border bg-muted/20 p-4"
        role="status"
      >
        <p className="font-semibold text-sm">
          {results.interim
            ? "Interim descriptive results"
            : "Final descriptive results"}
        </p>
        <p className="mt-1 text-muted-foreground text-sm">
          {results.primaryMetricName}. No automatic winner is selected.
          Freshness:{" "}
          {results.freshnessMinutes === undefined
            ? "unavailable"
            : `${results.freshnessMinutes} minutes ago`}
          .
        </p>
        <p className="mt-1 text-muted-foreground text-xs">
          Authority: {results.primaryMetricAuthority.replace("_", " ")} ·
          Assignment unit: unique assignment key · Filter:{" "}
          {describeMetricEventFilter(results.primaryMetricEventFilter)} ·
          Trusted source:{" "}
          {results.primaryMetricAvailability.replaceAll("_", " ")}.
        </p>
      </div>
      {results.issues.length ? (
        <section aria-label="Result warnings" className="grid gap-3">
          {results.issues.map((issue) => (
            <ExperimentIssueCard issue={issue} key={issue.code} />
          ))}
        </section>
      ) : null}
      <WorkflowPanel
        description="First qualifying exposure and at most one conversion per assignment unit. Intervals are 95% Wilson estimates."
        title="Conversion and uncertainty"
      >
        <div className="overflow-x-auto">
          <table className="w-full min-w-160 text-left text-sm">
            <caption className="sr-only">
              Conversion and uncertainty by Variant, with allocation, unique
              exposures, conversions, observed estimate, and the 95% Wilson
              interval.
            </caption>
            <thead>
              <tr className="border-b">
                <th className="py-2 pr-4" scope="col">
                  Variant
                </th>
                <th className="px-4 py-2" scope="col">
                  Allocation
                </th>
                <th className="px-4 py-2" scope="col">
                  Unique exposures
                </th>
                <th className="px-4 py-2" scope="col">
                  Conversions
                </th>
                <th className="px-4 py-2" scope="col">
                  Observed estimate
                </th>
                <th className="py-2 pl-4" scope="col">
                  95% interval
                </th>
              </tr>
            </thead>
            <tbody>
              {results.variants.map((variant) => (
                <tr className="border-b last:border-0" key={variant.variantId}>
                  <th className="py-3 pr-4 font-medium" scope="row">
                    {variant.name}{" "}
                    <span className="text-muted-foreground text-xs capitalize">
                      ({variant.role})
                    </span>
                  </th>
                  <td className="px-4 py-3">
                    {percent(variant.allocationBasisPoints / 10_000)}{" "}
                    <span className="text-muted-foreground text-xs">
                      ({variant.allocationBasisPoints} bp)
                    </span>
                  </td>
                  <td className="px-4 py-3 tabular-nums">
                    {variant.uniqueExposures}
                  </td>
                  <td className="px-4 py-3 tabular-nums">
                    {variant.conversions}
                  </td>
                  <td className="px-4 py-3 tabular-nums">
                    {percent(variant.estimate)}
                  </td>
                  <td className="py-3 pl-4 tabular-nums">
                    {percent(variant.interval.low)}–
                    {percent(variant.interval.high)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </WorkflowPanel>
      <WorkflowPanel
        description="Absolute lift uses a 95% Newcombe interval. Relative lift is descriptive and omitted when Control is zero."
        title="Descriptive lift"
      >
        {results.treatments.length ? (
          <ul className="grid gap-3">
            {results.treatments.map((lift) => {
              const variant = results.variants.find(
                (candidate) => candidate.variantId === lift.variantId
              );
              return (
                <li className="rounded border p-3 text-sm" key={lift.variantId}>
                  <strong>{variant?.name ?? "Treatment"}</strong>
                  <span className="ml-3">
                    Absolute {percent(lift.absoluteLift)} (
                    {percent(lift.interval.low)}–{percent(lift.interval.high)})
                  </span>
                  {lift.relativeLift === undefined ? (
                    <span className="ml-3 text-muted-foreground">
                      Relative lift unavailable
                    </span>
                  ) : (
                    <span className="ml-3">
                      Relative {percent(lift.relativeLift)}
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="text-muted-foreground text-sm">
            Lift is unavailable until qualifying exposure data exists.
          </p>
        )}
      </WorkflowPanel>
      <WorkflowPanel
        description="Pearson chi-square compares first qualifying unique exposures with immutable expected allocation. It never stops the Experiment automatically."
        title="Sample-ratio diagnostic"
      >
        <div className="flex flex-wrap gap-3 text-sm">
          <strong className="capitalize">
            {results.srm.status.replaceAll("_", " ")}
          </strong>
          <span>Severity: {results.srm.severity}</span>
          <span>χ² {results.srm.statistic.toFixed(3)}</span>
          <span>df {results.srm.degreesOfFreedom}</span>
          <span>p {results.srm.pValue.toPrecision(3)}</span>
        </div>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-120 text-left text-sm">
            <caption className="sr-only">
              Sample ratio mismatch cells: observed versus expected assignment
              counts per Variant.
            </caption>
            <thead>
              <tr className="border-b">
                <th className="py-2 pr-4" scope="col">
                  Variant
                </th>
                <th className="px-4 py-2" scope="col">
                  Observed
                </th>
                <th className="px-4 py-2" scope="col">
                  Expected
                </th>
                <th className="py-2 pl-4" scope="col">
                  Observed / expected share
                </th>
              </tr>
            </thead>
            <tbody>
              {results.srm.cells.map((cell) => (
                <tr className="border-b last:border-0" key={cell.variantId}>
                  <th className="py-3 pr-4 font-medium" scope="row">
                    {results.variants.find(
                      (variant) => variant.variantId === cell.variantId
                    )?.name ?? cell.variantId}
                  </th>
                  <td className="px-4 py-3 tabular-nums">{cell.observed}</td>
                  <td className="px-4 py-3 tabular-nums">
                    {cell.expected.toFixed(1)}
                  </td>
                  <td className="py-3 pl-4 tabular-nums">
                    {percent(cell.observedShare)} /{" "}
                    {percent(cell.expectedShare)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {results.srm.exclusions.length ? (
          <p className="mt-3 text-muted-foreground text-xs">
            Excluded: {results.srm.exclusions.join(", ")}.
          </p>
        ) : null}
      </WorkflowPanel>
      <div className="grid gap-5 lg:grid-cols-2">
        <WorkflowPanel title="Guardrails">
          <ul className="grid gap-3">
            {results.guardrails.map((guardrail) => (
              <li className="rounded border p-3" key={guardrail.name}>
                <div className="flex items-center justify-between gap-3">
                  <strong className="text-sm">{guardrail.name}</strong>
                  <span className="font-semibold text-xs uppercase">
                    {guardrail.severity}
                  </span>
                </div>
                <p className="mt-1 text-muted-foreground text-sm">
                  {guardrail.summary}
                </p>
                {guardrail.estimate === undefined ? null : (
                  <p className="mt-1 text-xs">
                    Observed estimate: {percent(guardrail.estimate)}
                  </p>
                )}
                {guardrail.code ? (
                  <p className="mt-1 font-mono text-muted-foreground text-xs">
                    {guardrail.code}
                  </p>
                ) : null}
                {guardrail.investigation ? (
                  <p className="mt-2 text-xs">
                    <strong>Investigate:</strong> {guardrail.investigation}
                  </p>
                ) : null}
                {guardrail.recoveryAction ? (
                  <p className="mt-1 text-xs">
                    <strong>Recovery:</strong> {guardrail.recoveryAction}
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
        </WorkflowPanel>
        <WorkflowPanel title="Fallback and maturity">
          <dl className="grid gap-3 text-sm">
            <div>
              <dt className="text-muted-foreground">Fallback exposures</dt>
              <dd className="font-semibold tabular-nums">
                {results.fallbackExposures}
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground">
                Attribution and late-event window
              </dt>
              <dd className="font-semibold">
                {results.attributionWindowMature ? "Mature" : "Still maturing"}
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Observation window</dt>
              <dd>
                {results.observationStartsAt ?? "Unavailable"} –{" "}
                {results.observationEndsAt ?? "Now"}
              </dd>
            </div>
          </dl>
        </WorkflowPanel>
      </div>
    </div>
  );
}
