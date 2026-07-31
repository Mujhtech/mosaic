import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  DefinitionRow,
  StatusPill,
} from "@/features/billing-ledger/components/billing-chrome";
import {
  describeReplayRefusal,
  describeReplayScopeIssue,
  NO_AUTO_PROMOTION_NOTE,
  replayComparisonExplanation,
  replayComparisonLabel,
  replayComparisonTone,
  replaySummary,
  validateReplayScope,
} from "@/features/billing-projection/types/projection-vocabulary";
import { WorkflowPanel } from "@/features/orgs/components/workspace-page";
import type {
  CreateProjectionReplayRequest,
  ProjectionReplayResult,
} from "@/generated/api";

interface ProjectionReplayPanelProps {
  activeRuleVersion: number | undefined;
  canManage: boolean;
  membersHref: string;
  onReplay: (
    request: CreateProjectionReplayRequest
  ) => Promise<ProjectionReplayResult | undefined>;
}

/**
 * Recomputing committed state from the immutable facts.
 *
 * Nothing here promotes anything. The panel reports what recomputing produced
 * and stops; turning a `changed` comparison into the active semantics is a
 * separate, deliberate act that Phase 9B does not automate.
 */
export function ProjectionReplayPanel({
  activeRuleVersion,
  canManage,
  membersHref,
  onReplay,
}: ProjectionReplayPanelProps) {
  const [request, setRequest] = useState<CreateProjectionReplayRequest>({});
  const [result, setResult] = useState<ProjectionReplayResult | undefined>(
    undefined
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const scopeIssue = validateReplayScope(request);

  async function run() {
    setBusy(true);
    setError(null);
    setResult(undefined);
    try {
      setResult(await onReplay(request));
    } catch (cause) {
      setError(
        describeReplayRefusal(cause) ??
          (cause instanceof Error
            ? cause.message
            : "Mosaic could not run this replay.")
      );
    } finally {
      setBusy(false);
    }
  }

  if (!canManage) {
    return (
      <WorkflowPanel title="Replay a projection">
        <p className="text-sm leading-6">
          Replaying a projection requires organization owner or admin
          permission.
        </p>
        <a
          className="mt-2 inline-flex font-semibold text-primary text-sm"
          href={membersHref}
        >
          Ask an Owner or Admin to run a replay
        </a>
      </WorkflowPanel>
    );
  }

  return (
    <WorkflowPanel
      description="Recompute committed entitlement state from the immutable facts and report what moved. Replayed state goes through the same lock and atomic commit as live projection, and prior snapshots are never deleted."
      title="Replay a projection"
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field>
          <FieldLabel htmlFor="replay-subscription">
            Subscription Instance
          </FieldLabel>
          <Input
            id="replay-subscription"
            onChange={(event) => {
              const value = event.currentTarget.value || undefined;
              setRequest((current) => ({
                ...current,
                subscriptionInstanceId: value,
              }));
            }}
            value={request.subscriptionInstanceId ?? ""}
          />
        </Field>
        <Field>
          <FieldLabel htmlFor="replay-customer">Billing Customer</FieldLabel>
          <Input
            id="replay-customer"
            onChange={(event) => {
              const value = event.currentTarget.value || undefined;
              setRequest((current) => ({
                ...current,
                billingCustomerId: value,
              }));
            }}
            value={request.billingCustomerId ?? ""}
          />
        </Field>
        <Field>
          <FieldLabel htmlFor="replay-window-start">
            Fact window start
          </FieldLabel>
          <Input
            id="replay-window-start"
            onChange={(event) => {
              const value = toIsoInstant(event.currentTarget.value);
              setRequest((current) => ({ ...current, windowStart: value }));
            }}
            type="datetime-local"
            value={toLocalInput(request.windowStart)}
          />
        </Field>
        <Field>
          <FieldLabel htmlFor="replay-window-end">Fact window end</FieldLabel>
          <Input
            id="replay-window-end"
            onChange={(event) => {
              const value = toIsoInstant(event.currentTarget.value);
              setRequest((current) => ({ ...current, windowEnd: value }));
            }}
            type="datetime-local"
            value={toLocalInput(request.windowEnd)}
          />
          <FieldDescription>
            The window bounds facts, not lineage creation: a scope is in scope
            when it holds a fact whose effective or recorded time falls inside
            it.
          </FieldDescription>
        </Field>
        <Field>
          <FieldLabel htmlFor="replay-rule-version">
            Projection rule version
          </FieldLabel>
          <Input
            id="replay-rule-version"
            min={0}
            onChange={(event) => {
              const raw = event.currentTarget.value;
              const value = raw ? Number(raw) : undefined;
              setRequest((current) => ({
                ...current,
                projectionRuleVersion: value,
              }));
            }}
            type="number"
            value={request.projectionRuleVersion ?? ""}
          />
          <FieldDescription>
            Leave blank to use the active version{" "}
            {activeRuleVersion === undefined ? "" : `(${activeRuleVersion})`}. A
            version this build does not derive under is refused rather than
            approximated.
          </FieldDescription>
        </Field>
      </div>

      {scopeIssue ? (
        <p className="mt-3 text-muted-foreground text-sm leading-6">
          {describeReplayScopeIssue(scopeIssue)}
        </p>
      ) : null}

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <Button
          disabled={busy || Boolean(scopeIssue)}
          onClick={() => {
            run();
          }}
          type="button"
        >
          {busy ? "Replaying…" : "Run replay"}
        </Button>
        <p className="text-muted-foreground text-xs leading-5">
          {NO_AUTO_PROMOTION_NOTE}
        </p>
      </div>

      {error ? (
        <p className="mt-3 text-destructive text-sm leading-6" role="alert">
          {error}
        </p>
      ) : null}

      {result ? (
        <div className="mt-4 rounded border p-4">
          <p className="font-semibold text-sm leading-6">
            {replaySummary(result)}
          </p>
          <dl className="mt-2">
            <DefinitionRow
              label="Rule version used"
              value={String(result.projectionRuleVersion ?? "—")}
            />
          </dl>
          <ul className="mt-3 space-y-3">
            {(result.outcomes ?? []).map((outcome) => (
              <li
                className="rounded border p-3"
                key={outcome.projectionScopeKey}
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="break-all font-mono text-xs">
                    {outcome.projectionScopeKey}
                  </span>
                  <StatusPill
                    label={replayComparisonLabel(outcome.comparison)}
                    tone={replayComparisonTone(outcome.comparison)}
                  />
                  {outcome.materialized ? (
                    <StatusPill label="New snapshot written" tone="attention" />
                  ) : (
                    <StatusPill label="Nothing written" tone="neutral" />
                  )}
                </div>
                <p className="mt-2 text-muted-foreground text-sm leading-6">
                  {replayComparisonExplanation(outcome.comparison)}
                </p>
                {(outcome.changedEntitlementIds ?? []).length > 0 ? (
                  <p className="mt-1 text-muted-foreground text-xs">
                    Entitlements that moved:{" "}
                    {(outcome.changedEntitlementIds ?? []).join(", ")}
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </WorkflowPanel>
  );
}

function toLocalInput(iso: string | undefined) {
  if (!iso) {
    return "";
  }
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) {
    return "";
  }
  const offset = parsed.getTimezoneOffset() * 60_000;
  return new Date(parsed.getTime() - offset).toISOString().slice(0, 16);
}

function toIsoInstant(local: string) {
  if (!local) {
    return;
  }
  const parsed = new Date(local);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString();
}
