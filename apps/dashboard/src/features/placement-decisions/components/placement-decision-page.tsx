import { ArchiveIcon } from "@phosphor-icons/react/dist/ssr/Archive";
import { FloppyDiskIcon } from "@phosphor-icons/react/dist/ssr/FloppyDisk";
import { useForm } from "@tanstack/react-form";
import {
  queryOptions,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";

import { EmptyState } from "@/components/feedback/empty-state";
import { ErrorState } from "@/components/feedback/error-state";
import { LoadingState } from "@/components/feedback/loading-state";
import { Button } from "@/components/ui/button";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  ApiErrorDetails,
  ApiErrorRecoveryAction,
  RequestIdCopy,
} from "@/features/auth/components/hosted-resource-boundary";
import { MonetizationWorkspace } from "@/features/environments/components/monetization-workspace";
import { environmentsQueryOptions } from "@/features/environments/queries/environments-query";
import { paywallsQueryOptions } from "@/features/paywalls/queries/paywall-queries";
import { usePlacementDecisionsAdapter } from "@/features/placement-decisions/api/use-placement-decisions-adapter";
import { AttributeDefinitions } from "@/features/placement-decisions/components/attribute-definitions";
import { DecisionSimulator } from "@/features/placement-decisions/components/decision-simulator";
import { OutcomeEditor } from "@/features/placement-decisions/components/outcome-editor";
import { QaOverrides } from "@/features/placement-decisions/components/qa-overrides";
import { RuleBuilder } from "@/features/placement-decisions/components/rule-builder";
import { openPlacementRule } from "@/features/placement-decisions/components/rule-navigation";
import {
  saveRuleSetMutationOptions,
  validateRuleSetMutationOptions,
} from "@/features/placement-decisions/mutations/placement-decision-mutations";
import {
  attributeDefinitionsQueryOptions,
  placementDecisionKeys,
  placementDecisionQueryOptions,
} from "@/features/placement-decisions/queries/placement-decision-queries";
import type {
  AssignmentPolicy,
  AttributeDefinition,
  DecisionOutcome,
  DecisionValidation,
  NamedFallback,
  PlacementDecisionDetail,
  PlacementRule,
  PlacementRuleSetDraft,
} from "@/features/placement-decisions/types/placement-decision";
import type { HostedPaywallListItem } from "@/features/publishing/api/hosted-publishing-adapter";
import { useHostedPublishingAdapter } from "@/features/publishing/api/use-hosted-publishing-adapter";
import { describeApiError } from "@/lib/api/errors";
import { workspaceScopeParams } from "@/lib/routing/workspace-params";

type DetailTab = "overview" | "rules" | "simulator" | "overrides";

const ASSIGNMENT_POLICY_OPTIONS = [
  { label: "Installation (default)", value: "installation" },
  { label: "Identified user", value: "identified_user" },
  {
    label: "Identified user, otherwise installation",
    value: "identified_user_or_installation",
  },
];

export function PlacementDecisionPage({
  environmentId,
  organizationId,
  placementId,
  projectId,
}: {
  environmentId: string;
  organizationId: string;
  placementId: string;
  projectId: string;
}) {
  const adapter = usePlacementDecisionsAdapter();
  const publishingAdapter = useHostedPublishingAdapter();
  const scope = { environmentId, placementId, projectId };
  const detail = useQuery(placementDecisionQueryOptions(scope, adapter));
  const paywalls = useQuery(paywallsQueryOptions(projectId, publishingAdapter));
  const paywallVersions = useQuery(
    queryOptions({
      enabled: paywalls.isSuccess,
      queryKey: [
        "placement-decision-paywall-versions",
        projectId,
        environmentId,
        publishingAdapter,
        paywalls.data,
      ],
      queryFn: async () => {
        const active =
          paywalls.data?.filter((paywall) => paywall.status === "active") ?? [];
        const versions = await Promise.all(
          active.map(async (paywall) => {
            const published = await publishingAdapter.listPublishedVersions({
              environmentId,
              paywallId: paywall.id,
              projectId,
            });
            const [latest] = published.toSorted(
              (left, right) => right.versionNumber - left.versionNumber
            );
            return latest
              ? {
                  id: latest.id,
                  key: paywall.key,
                  name: `${paywall.name} · v${latest.versionNumber}`,
                  status: "active" as const,
                  updatedAt: latest.createdAt,
                }
              : null;
          })
        );
        return versions.filter((version) => version !== null);
      },
    })
  );
  const attributes = useQuery(
    attributeDefinitionsQueryOptions(projectId, adapter)
  );
  const environments = useQuery(environmentsQueryOptions(projectId));
  const environment = environments.data?.items.find(
    (item) => item.id === environmentId
  );

  return (
    <MonetizationWorkspace
      description="Keep the stable app intent while selecting a deterministic default, Rules, fallbacks, and QA behavior for this Environment."
      environmentId={environmentId}
      organizationId={organizationId}
      projectId={projectId}
      surface="placements"
      title={detail.data?.name ?? "Placement"}
    >
      {/* Loading and error are mutually exclusive: a failed reference query
          previously left the spinner mounted next to the error. */}
      {(() => {
        if (
          detail.error ||
          paywalls.error ||
          paywallVersions.error ||
          attributes.error
        ) {
          return (
            <ErrorState
              description={
                describeApiError(
                  detail.error ??
                    paywalls.error ??
                    paywallVersions.error ??
                    attributes.error
                ).description
              }
              onRetry={() => {
                detail.refetch();
                paywalls.refetch();
                paywallVersions.refetch();
                attributes.refetch();
              }}
            />
          );
        }
        if (
          detail.isPending ||
          paywalls.isPending ||
          paywallVersions.isPending ||
          attributes.isPending
        ) {
          return (
            <LoadingState description="Loading the Placement decision settings and their references." />
          );
        }
        return null;
      })()}
      {detail.data && paywallVersions.data && attributes.data ? (
        <DecisionWorkspace
          adapter={adapter}
          attributes={attributes.data}
          detail={detail.data}
          environmentKind={environment?.mode ?? "development"}
          organizationId={organizationId}
          paywalls={paywallVersions.data}
          scope={scope}
        />
      ) : null}
    </MonetizationWorkspace>
  );
}

function DecisionWorkspace({
  adapter,
  attributes,
  detail,
  environmentKind,
  organizationId,
  paywalls,
  scope,
}: {
  adapter: ReturnType<typeof usePlacementDecisionsAdapter>;
  attributes: readonly AttributeDefinition[];
  detail: PlacementDecisionDetail;
  environmentKind: "development" | "staging" | "production";
  organizationId: string;
  paywalls: readonly HostedPaywallListItem[];
  scope: { environmentId: string; placementId: string; projectId: string };
}) {
  const [tab, setTab] = useState<DetailTab>("overview");
  const queryClient = useQueryClient();
  const save = useMutation(
    saveRuleSetMutationOptions(scope, adapter, queryClient)
  );
  const validation = useMutation(
    validateRuleSetMutationOptions(scope, adapter)
  );
  const form = useForm({
    defaultValues: detail.draft,
    onSubmit: async ({ value }) => {
      const saved = await save.mutateAsync(value);
      form.reset(saved);
    },
  });
  // TanStack Form's instance type is deep enough that naming it in a dependency
  // array trips TS2589, so the callbacks read it through a ref instead. The
  // instance is stable across renders, so the behaviour is unchanged. The ref
  // is written in an effect rather than during render, because React can
  // replay or discard render work and a render-time mutation leaks out of
  // renders that never commit.
  const formRef = useRef(form);
  useEffect(() => {
    formRef.current = form;
  }, [form]);
  const handleClick7 = useCallback(() => {
    formRef.current.handleSubmit();
  }, []);
  const handleClick5 = useCallback(
    () => validation.mutate(formRef.current.state.values.revision),
    [validation]
  );
  const handleClick4 = useCallback(() => {
    formRef.current.handleSubmit();
  }, []);
  const publish = useMutation({
    mutationFn: () =>
      adapter.publishRuleSet(scope, {
        revision: form.state.values.revision,
        ruleSetId: form.state.values.ruleSetId,
      }),
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: placementDecisionKeys.detail(scope, adapter),
      }),
  });
  const handleClick6 = useCallback(() => publish.mutate(), [publish]);
  const handleLoadServerRevision = useCallback(
    () =>
      queryClient.invalidateQueries({
        queryKey: placementDecisionKeys.detail(scope, adapter),
      }),
    [adapter, queryClient, scope]
  );
  const issues =
    validation.data?.issues ?? detail.draft.validation?.issues ?? [];
  const updateRules = (next: readonly PlacementRule[]) =>
    (
      form as unknown as {
        setFieldValue: (name: "rules", value: readonly PlacementRule[]) => void;
      }
    ).setFieldValue("rules", next);
  const updateFallbacks = useCallback(
    (next: readonly NamedFallback[]) =>
      (
        formRef.current as unknown as {
          setFieldValue: (
            name: "fallbacks",
            value: readonly NamedFallback[]
          ) => void;
        }
      ).setFieldValue("fallbacks", next),
    []
  );
  const updateDefaultOutcome = (next: DecisionOutcome) =>
    (
      form as unknown as {
        setFieldValue: (name: "defaultOutcome", value: DecisionOutcome) => void;
      }
    ).setFieldValue("defaultOutcome", next);
  const updateAssignmentPolicy = (next: AssignmentPolicy) =>
    (
      form as unknown as {
        setFieldValue: (
          name: "assignmentPolicy",
          value: AssignmentPolicy
        ) => void;
      }
    ).setFieldValue("assignmentPolicy", next);
  const openRule = (ruleId: string) =>
    openPlacementRule(ruleId, () => setTab("rules"));

  return (
    <div className="space-y-5">
      <PlacementSummaryCard
        adapter={adapter}
        detail={detail}
        organizationId={organizationId}
        scope={scope}
      />

      <DecisionTabList onTabChange={setTab} tab={tab} />

      {tab === "overview" ? (
        <div className="space-y-6">
          <section
            aria-labelledby="placement-overview-heading"
            className="grid gap-5 xl:grid-cols-2"
          >
            <PlacementDetailsForm
              adapter={adapter}
              detail={detail}
              scope={scope}
            />
            <form.Subscribe
              selector={(state) => ({
                assignmentPolicy: state.values.assignmentPolicy,
                defaultOutcome: state.values.defaultOutcome,
                fallbacks: state.values.fallbacks,
              })}
            >
              {({ assignmentPolicy, defaultOutcome, fallbacks }) => (
                <DefaultDecisionCard
                  assignmentPolicy={assignmentPolicy}
                  defaultOutcome={defaultOutcome}
                  fallbacks={fallbacks}
                  onAssignmentPolicyChange={updateAssignmentPolicy}
                  onDefaultOutcomeChange={updateDefaultOutcome}
                  paywalls={paywalls}
                />
              )}
            </form.Subscribe>
          </section>

          <form.Subscribe selector={(state) => state.values.fallbacks}>
            {(fallbacks) => (
              <NamedFallbacksSection
                fallbacks={fallbacks}
                onChange={updateFallbacks}
                paywalls={paywalls}
              />
            )}
          </form.Subscribe>

          <AliasAndUsage adapter={adapter} detail={detail} scope={scope} />
          <AttributeDefinitions adapter={adapter} projectId={scope.projectId} />
        </div>
      ) : null}

      {tab === "rules" ? (
        <form.Subscribe
          selector={(state) => ({
            fallbacks: state.values.fallbacks,
            rules: state.values.rules,
          })}
        >
          {({ fallbacks, rules }) => (
            <RuleBuilder
              attributes={attributes}
              fallbacks={fallbacks}
              issues={issues}
              onChange={updateRules}
              paywalls={paywalls}
              rules={rules}
            />
          )}
        </form.Subscribe>
      ) : null}
      {tab === "simulator" ? (
        <DecisionSimulator
          adapter={adapter}
          attributes={attributes}
          onOpenRule={openRule}
          scope={scope}
        />
      ) : null}
      {tab === "overrides" ? (
        <QaOverrides
          adapter={adapter}
          environmentKind={environmentKind}
          scope={scope}
        />
      ) : null}

      {tab === "overview" || tab === "rules" ? (
        <DraftActionBar
          isDirty={form.state.isDirty}
          onLoadServerRevision={handleLoadServerRevision}
          onOpenRule={openRule}
          onPublish={handleClick6}
          onRetryWithLocalWork={handleClick7}
          onSave={handleClick4}
          onValidate={handleClick5}
          pendingAction={draftPendingAction({
            publishing: publish.isPending,
            saving: save.isPending,
            validating: validation.isPending,
          })}
          publishErrorMessage={publish.error?.message}
          publishedVersion={publish.data?.version}
          saveErrorMessage={save.error?.message}
          validationResult={validation.data}
        />
      ) : null}
    </div>
  );
}

/**
 * The Placement identity card. It owns archiving because both archive paths —
 * the Placement itself and its active decision settings — are reachable only
 * from here, and their failure copy belongs beside the buttons that caused it.
 */
function PlacementSummaryCard({
  adapter,
  detail,
  organizationId,
  scope,
}: {
  adapter: ReturnType<typeof usePlacementDecisionsAdapter>;
  detail: PlacementDecisionDetail;
  organizationId: string;
  scope: { environmentId: string; placementId: string; projectId: string };
}) {
  const queryClient = useQueryClient();
  const [confirmingRuleSetArchive, setConfirmingRuleSetArchive] =
    useState(false);
  const handleClick2 = useCallback(() => setConfirmingRuleSetArchive(true), []);
  const archive = useMutation({
    mutationFn: () => adapter.archivePlacement(scope),
    onSuccess: () =>
      queryClient.setQueryData<PlacementDecisionDetail>(
        placementDecisionKeys.detail(scope, adapter),
        (current) => (current ? { ...current, status: "archived" } : current)
      ),
  });
  const handleClick = useCallback(() => archive.mutate(), [archive]);
  const archiveRuleSet = useMutation({
    mutationFn: () => adapter.archiveRuleSet(scope, detail.draft.ruleSetId),
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: placementDecisionKeys.detail(scope, adapter),
      }),
  });
  // Archiving a Placement or its rule set previously rendered the raw server
  // message. Mosaic-owned copy plus the correlation ID is the documented
  // support path, and a coded refusal here can name the page that resolves it.
  const handleConfirm = useCallback(() => {
    archiveRuleSet.mutate(undefined, {
      onSuccess: () => setConfirmingRuleSetArchive(false),
    });
  }, [archiveRuleSet]);
  const archiveError = archiveRuleSet.error ?? archive.error;
  const archiveFailure = archiveError
    ? describeApiError(archiveError, {
        environmentId: scope.environmentId,
        organizationId,
        projectId: scope.projectId,
      })
    : null;

  return (
    <div className="rounded border border-border p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="font-mono text-sm">{detail.key}</p>
          <p className="mt-1 text-muted-foreground text-xs">
            Stable Placement key · {detail.status} ·{" "}
            {detail.draftOrigin === "not_configured"
              ? "no decision rules configured yet"
              : `saved revision ${detail.draft.revision}`}
            {detail.publishedVersion
              ? ` · published v${detail.publishedVersion.version}`
              : " · not published"}
          </p>
          {detail.draftOrigin === "not_configured" ? (
            // Distinguishes "nobody has written rules here" from "a saved
            // rule set happens to be empty". The starting point below exists
            // only in this browser until it is saved.
            <p className="mt-1 text-muted-foreground text-xs leading-5">
              This Placement has no rule set on the server. What you see below
              is an unsaved starting point; nothing is created until you save.
            </p>
          ) : null}
        </div>
        <Button
          disabled={
            archive.isPending ||
            detail.status === "archived" ||
            detail.usage.ruleSetCount > 0
          }
          onClick={handleClick}
          size="sm"
          type="button"
          variant="outline"
        >
          <ArchiveIcon aria-hidden />
          {detail.status === "archived"
            ? "Placement archived"
            : "Archive Placement"}
        </Button>
      </div>
      {(() => {
        if (detail.status === "archived") {
          return (
            <p className="mt-3 text-muted-foreground text-sm" role="status">
              This Placement is archived and cannot receive decision changes.
            </p>
          );
        }
        if (detail.usage.ruleSetCount > 0) {
          return (
            <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded border border-border bg-muted/30 p-3">
              <div>
                <p className="font-medium text-sm">
                  Archive the active decision settings first
                </p>
                <p className="mt-1 text-muted-foreground text-xs">
                  This preserves published version history and removes the
                  active decision settings so the Placement can then be
                  archived. Archiving decision settings cannot be undone;
                  rebuilding them means recreating every rule by hand.
                </p>
              </div>
              <Button
                disabled={archiveRuleSet.isPending}
                onClick={handleClick2}
                size="sm"
                type="button"
                variant="outline"
              >
                <ArchiveIcon aria-hidden />
                {archiveRuleSet.isPending
                  ? "Archiving decision settings…"
                  : "Archive settings"}
              </Button>
              <ArchiveRuleSetConfirmation
                onConfirm={handleConfirm}
                onOpenChange={setConfirmingRuleSetArchive}
                open={confirmingRuleSetArchive}
                pending={archiveRuleSet.isPending}
                placementKey={detail.key}
              />
            </div>
          );
        }
        return null;
      })()}
      {archiveFailure ? (
        <div className="mt-3 space-y-2">
          <p className="text-destructive text-sm" role="alert">
            {archiveFailure.description}
          </p>
          <ApiErrorDetails details={archiveFailure.details} />
          {archiveFailure.recovery ? (
            <ApiErrorRecoveryAction recovery={archiveFailure.recovery} />
          ) : null}
          {archiveFailure.correlationId ? (
            <RequestIdCopy requestId={archiveFailure.correlationId} />
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function DecisionTabList({
  onTabChange,
  tab,
}: {
  onTabChange: (tab: DetailTab) => void;
  tab: DetailTab;
}) {
  return (
    <div
      aria-label="Placement decision"
      className="flex flex-wrap gap-1 rounded border border-border p-1"
      role="tablist"
    >
      {(["overview", "rules", "simulator", "overrides"] as const).map(
        (item) => (
          <Button
            aria-selected={tab === item}
            key={item}
            onClick={() => onTabChange(item)}
            role="tab"
            size="sm"
            type="button"
            variant={tab === item ? "secondary" : "ghost"}
          >
            {item === "overrides"
              ? "Test Overrides"
              : {
                  overview: "Overview",
                  rules: "Rules",
                  simulator: "Simulator",
                }[item]}
          </Button>
        )
      )}
    </div>
  );
}

function PlacementDetailsForm({
  adapter,
  detail,
  scope,
}: {
  adapter: ReturnType<typeof usePlacementDecisionsAdapter>;
  detail: PlacementDecisionDetail;
  scope: { environmentId: string; placementId: string; projectId: string };
}) {
  const queryClient = useQueryClient();
  const placementUpdate = useMutation({
    mutationFn: (input: { description?: string; name: string }) =>
      adapter.updatePlacement(scope, input),
    onSuccess: (updated) =>
      queryClient.setQueryData<PlacementDecisionDetail>(
        placementDecisionKeys.detail(scope, adapter),
        (current) => (current ? { ...current, ...updated } : current)
      ),
  });

  return (
    <div className="rounded border border-border p-4">
      <h2 className="font-semibold" id="placement-overview-heading">
        Placement details
      </h2>
      {/* Client-rendered authenticated SPA: no server actions in this
          stack, and nothing here works without JS. */}
      <form
        className="mt-4 space-y-3"
        onSubmit={(event) => {
          event.preventDefault();
          const data = new FormData(event.currentTarget);
          placementUpdate.mutate({
            description: String(data.get("description") ?? "") || undefined,
            name: String(data.get("name") ?? ""),
          });
        }}
      >
        <Field>
          <FieldLabel htmlFor="placement-detail-name">Internal name</FieldLabel>
          <Input
            defaultValue={detail.name}
            id="placement-detail-name"
            name="name"
          />
        </Field>
        <Field>
          <FieldLabel htmlFor="placement-detail-description">
            Description
          </FieldLabel>
          <Input
            defaultValue={detail.description}
            id="placement-detail-description"
            name="description"
          />
        </Field>
        <Button disabled={placementUpdate.isPending} size="sm" type="submit">
          Save details
        </Button>
        {placementUpdate.error ? (
          <p className="text-destructive text-sm" role="alert">
            {placementUpdate.error.message}
          </p>
        ) : null}
      </form>
    </div>
  );
}

function DefaultDecisionCard({
  assignmentPolicy,
  defaultOutcome,
  fallbacks,
  onAssignmentPolicyChange,
  onDefaultOutcomeChange,
  paywalls,
}: {
  assignmentPolicy: AssignmentPolicy;
  defaultOutcome: DecisionOutcome;
  fallbacks: readonly NamedFallback[];
  onAssignmentPolicyChange: (next: AssignmentPolicy) => void;
  onDefaultOutcomeChange: (next: DecisionOutcome) => void;
  paywalls: readonly HostedPaywallListItem[];
}) {
  return (
    <div className="space-y-4 rounded border border-border p-4">
      <div>
        <h2 className="font-semibold">Default decision</h2>
        <p className="mt-1 text-muted-foreground text-sm">
          Used when no Rule wins. Existing simple bindings compile here as a
          default Paywall.
        </p>
      </div>
      <OutcomeEditor
        fallbacks={fallbacks}
        id="default-outcome"
        label="When no Rule matches"
        onChange={onDefaultOutcomeChange}
        paywalls={paywalls}
        value={defaultOutcome}
      />
      <Field>
        <FieldLabel htmlFor="assignment-policy">
          Rollout assignment identity
        </FieldLabel>
        <Select
          items={ASSIGNMENT_POLICY_OPTIONS}
          onValueChange={(value) =>
            onAssignmentPolicyChange(
              value as PlacementRuleSetDraft["assignmentPolicy"]
            )
          }
          value={assignmentPolicy}
        >
          <SelectTrigger id="assignment-policy">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {ASSIGNMENT_POLICY_OPTIONS.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-muted-foreground text-xs">
          Identification can change rollout only when a user-based policy is
          selected. Assignment values are never shown in traces.
        </p>
      </Field>
    </div>
  );
}

/**
 * The three mutations behind this bar are mutually exclusive in practice —
 * each button disables while its own request is in flight — so they arrive as
 * one discriminated value rather than three independent booleans that could
 * encode states the UI has no rendering for.
 */
type DraftPendingAction = "publishing" | "saving" | "validating";

/** Save is checked first: it is the only action available while dirty. */
function draftPendingAction(pending: {
  publishing: boolean;
  saving: boolean;
  validating: boolean;
}): DraftPendingAction | undefined {
  if (pending.saving) {
    return "saving";
  }
  if (pending.validating) {
    return "validating";
  }
  return pending.publishing ? "publishing" : undefined;
}

function DraftActionBar({
  isDirty,
  onLoadServerRevision,
  onOpenRule,
  onPublish,
  onRetryWithLocalWork,
  onSave,
  onValidate,
  pendingAction,
  publishErrorMessage,
  publishedVersion,
  saveErrorMessage,
  validationResult,
}: {
  isDirty: boolean;
  pendingAction?: DraftPendingAction;
  onLoadServerRevision: () => void;
  onOpenRule: (ruleId: string) => void;
  onPublish: () => void;
  onRetryWithLocalWork: () => void;
  onSave: () => void;
  onValidate: () => void;
  publishErrorMessage?: string;
  publishedVersion?: number;
  saveErrorMessage?: string;
  validationResult?: DecisionValidation;
}) {
  return (
    <section
      aria-labelledby="decision-actions-heading"
      className="sticky bottom-3 z-10 rounded border border-border bg-background p-4 shadow-lg"
    >
      <h2 className="sr-only" id="decision-actions-heading">
        Draft actions
      </h2>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          disabled={pendingAction === "saving"}
          onClick={onSave}
          type="button"
        >
          <FloppyDiskIcon aria-hidden />
          {pendingAction === "saving" ? "Saving…" : "Save changes"}
        </Button>
        <Button
          disabled={pendingAction === "validating" || isDirty}
          onClick={onValidate}
          type="button"
          variant="outline"
        >
          {pendingAction === "validating"
            ? "Validating…"
            : "Validate for release"}
        </Button>
        <Button
          disabled={
            isDirty ||
            pendingAction === "publishing" ||
            !validationResult?.valid
          }
          onClick={onPublish}
          type="button"
          variant="outline"
        >
          {pendingAction === "publishing"
            ? "Publishing…"
            : "Publish decision rules"}
        </Button>
        <Link
          className="ms-auto font-medium text-primary text-sm"
          params={(prev) => ({
            ...prev,
            ...workspaceScopeParams(prev),
          })}
          to="/orgs/$organizationId/projects/$projectId/env/$environmentKey/monetization/releases"
        >
          Review release history
        </Link>
      </div>
      {isDirty ? (
        <p className="mt-2 text-muted-foreground text-xs" role="status">
          Save changes before validation. Unsaved work remains in this form if
          the server reports a revision conflict.
        </p>
      ) : null}
      {saveErrorMessage ? (
        <div
          className="mt-3 rounded border border-destructive/25 bg-destructive/5 p-3"
          role="alert"
        >
          <p className="text-destructive text-sm">{saveErrorMessage}</p>
          <div className="mt-2 flex gap-2">
            <Button
              onClick={onRetryWithLocalWork}
              size="sm"
              type="button"
              variant="outline"
            >
              Retry with local work
            </Button>
            <Button
              onClick={onLoadServerRevision}
              size="sm"
              type="button"
              variant="ghost"
            >
              Load server revision
            </Button>
          </div>
        </div>
      ) : null}
      {publishedVersion === undefined ? null : (
        <p className="mt-2 text-primary text-sm" role="status">
          Decision version {publishedVersion} is immutable and ready for the
          next Configuration Release.
        </p>
      )}
      {publishErrorMessage ? (
        <p className="mt-2 text-destructive text-sm" role="alert">
          {publishErrorMessage} Validate again, resolve the linked blocker, or
          reload the latest saved revision.
        </p>
      ) : null}
      {validationResult ? (
        <ValidationSummary
          issues={validationResult.issues}
          onOpenRule={onOpenRule}
          valid={validationResult.valid}
        />
      ) : null}
    </section>
  );
}

/**
 * Named fallbacks own their own row identity. The fallback key is the field an
 * operator edits, so keying a row on it would remount the row and drop focus on
 * every keystroke; keying on the array index would move a half-typed key onto a
 * different fallback after a removal. Each row therefore carries a minted id
 * that is created with the row and discarded with it, and adding lives here so
 * that a new row and its id are created in the same handler.
 */
function NamedFallbacksSection({
  fallbacks,
  onChange,
  paywalls,
}: {
  fallbacks: readonly NamedFallback[];
  onChange: (fallbacks: readonly NamedFallback[]) => void;
  paywalls: Parameters<typeof OutcomeEditor>[0]["paywalls"];
}) {
  const nextRowId = useRef(fallbacks.length);
  const [rowIds, setRowIds] = useState<number[]>(() =>
    Array.from({ length: fallbacks.length }, (_, index) => index)
  );
  const handleAdd = useCallback(() => {
    const mintedId = nextRowId.current;
    nextRowId.current += 1;
    setRowIds((current) => [...current, mintedId]);
    onChange([
      ...fallbacks,
      {
        key: `fallback_${fallbacks.length + 1}`,
        outcome: { type: "no_paywall" },
      },
    ]);
  }, [fallbacks, onChange]);
  const handleRemove = useCallback(
    (index: number) => {
      setRowIds((current) =>
        current.filter((_, itemIndex) => itemIndex !== index)
      );
      onChange(fallbacks.filter((_, itemIndex) => itemIndex !== index));
    },
    [fallbacks, onChange]
  );

  return (
    <section
      aria-labelledby="fallbacks-heading"
      className="rounded border border-border p-4"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-semibold" id="fallbacks-heading">
            Named fallbacks
          </h2>
          <p className="mt-1 text-muted-foreground text-sm">
            Explicit recovery paths for incompatible content, missing Product
            mappings, unavailable providers, and unknown Access state.
          </p>
        </div>
        <Button onClick={handleAdd} size="sm" type="button" variant="outline">
          Add fallback
        </Button>
      </div>
      {fallbacks.length === 0 ? (
        <EmptyState
          className="mt-4"
          description="Add a named fallback before referencing one from a Rule or Paywall-unavailability outcome."
          title="No named fallbacks"
        />
      ) : (
        <ul className="mt-4 space-y-3">
          {fallbacks.map((fallback, index) => (
            <li
              className="grid gap-3 rounded border p-3 lg:grid-cols-[14rem_1fr_auto]"
              key={rowIds[index]}
            >
              <Field>
                <FieldLabel htmlFor={`fallback-${index}-key`}>
                  Fallback key
                </FieldLabel>
                <Input
                  id={`fallback-${index}-key`}
                  onChange={(event) =>
                    onChange(
                      fallbacks.map((item, itemIndex) =>
                        itemIndex === index
                          ? { ...item, key: event.currentTarget.value }
                          : item
                      )
                    )
                  }
                  value={fallback.key}
                />
              </Field>
              <OutcomeEditor
                fallbacks={fallbacks.filter(
                  (_, itemIndex) => itemIndex !== index
                )}
                id={`fallback-${index}`}
                onChange={(outcome) =>
                  onChange(
                    fallbacks.map((item, itemIndex) =>
                      itemIndex === index ? { ...item, outcome } : item
                    )
                  )
                }
                paywalls={paywalls}
                value={fallback.outcome}
              />
              <Button
                aria-label={`Remove fallback ${fallback.key}`}
                onClick={() => handleRemove(index)}
                size="sm"
                type="button"
                variant="ghost"
              >
                Remove
              </Button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function AliasAndUsage({
  adapter,
  detail,
  scope,
}: {
  adapter: ReturnType<typeof usePlacementDecisionsAdapter>;
  detail: PlacementDecisionDetail;
  scope: { environmentId: string; placementId: string; projectId: string };
}) {
  const queryClient = useQueryClient();
  const alias = useMutation({
    mutationFn: (key: string) => adapter.createAlias(scope, key),
    onSuccess: (created) =>
      queryClient.setQueryData<PlacementDecisionDetail>(
        placementDecisionKeys.detail(scope, adapter),
        (current) =>
          current
            ? { ...current, aliases: [...current.aliases, created] }
            : current
      ),
  });

  return (
    <section
      aria-labelledby="alias-heading"
      className="grid gap-5 xl:grid-cols-2"
    >
      <div className="rounded border border-border p-4">
        <h2 className="font-semibold" id="alias-heading">
          Key aliases
        </h2>
        <p className="mt-1 text-muted-foreground text-sm">
          Keys are never edited in place. Add an old key as an alias to keep
          installed application calls working.
        </p>
        {/* Client-rendered authenticated SPA: no server actions in this
            stack, and nothing here works without JS. */}
        <form
          className="mt-3 flex gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            const input = event.currentTarget.elements.namedItem(
              "alias"
            ) as HTMLInputElement;
            if (input.value.trim()) {
              alias.mutate(input.value.trim());
            }
          }}
        >
          <Input
            aria-label="Placement alias"
            name="alias"
            pattern="[a-z][a-z0-9_]{0,63}"
            placeholder="old_export_key"
          />
          <Button type="submit" variant="outline">
            Add alias
          </Button>
        </form>
        {alias.error ? (
          <p className="mt-2 text-destructive text-sm" role="alert">
            {alias.error.message}
          </p>
        ) : null}
        <ul className="mt-3 space-y-1 text-sm">
          {detail.aliases.map((item) => (
            <li key={item.key}>
              <code>{item.key}</code> · {item.status}
            </li>
          ))}
        </ul>
      </div>
      <div className="rounded border border-border p-4">
        <h2 className="font-semibold">Usage</h2>
        <dl className="mt-3 grid grid-cols-[1fr_auto] gap-2 text-sm">
          <dt>Decision configurations</dt>
          <dd>{detail.usage.ruleSetCount}</dd>
          <dt>Published Rules</dt>
          <dd>{detail.usage.publishedRuleCount}</dd>
          <dt>Aliases</dt>
          <dd>{detail.usage.aliasCount}</dd>
        </dl>
      </div>
    </section>
  );
}

export function ValidationSummary({
  issues,
  onOpenRule,
  valid,
}: {
  issues: readonly {
    code: string;
    message: string;
    severity: "error" | "warning";
    ruleId?: string;
    recoveryHref?: string;
    recoveryLabel?: string;
  }[];
  onOpenRule: (ruleId: string) => void;
  valid: boolean;
}) {
  const errorCount = issues.filter(
    (issue) => issue.severity === "error"
  ).length;
  const warningCount = issues.length - errorCount;
  return (
    <div
      className={(() => {
        if (errorCount > 0 || !valid) {
          return "mt-3 rounded border border-destructive/25 bg-destructive/5 p-3";
        }
        if (warningCount > 0) {
          return "mt-3 rounded border border-amber-500/35 bg-amber-500/10 p-3";
        }
        return "mt-3 rounded border border-primary/25 bg-primary/5 p-3";
      })()}
      role={errorCount > 0 || !valid ? "alert" : "status"}
    >
      <p className="font-semibold">
        {(() => {
          if (errorCount > 0 || !valid) {
            return "Publishing is blocked.";
          }
          if (warningCount > 0) {
            return `Ready to publish with ${warningCount} ${warningCount === 1 ? "warning" : "warnings"}.`;
          }
          return "Decision rules are ready for the next Configuration Release.";
        })()}
      </p>
      {issues.length > 0 ? (
        <ul className="mt-2 space-y-2 text-sm">
          {issues.map((issue) => (
            <li
              className={
                issue.severity === "warning"
                  ? "text-amber-800 dark:text-amber-200"
                  : undefined
              }
              key={`${issue.code}:${issue.message}`}
            >
              <span className="font-medium">
                {issue.severity === "warning" ? "Warning: " : "Error: "}
              </span>
              <span>{issue.message}</span>
              {(() => {
                const issueRuleId = issue.ruleId;
                if (issueRuleId) {
                  return (
                    <Button
                      className="ms-2"
                      onClick={() => onOpenRule(issueRuleId)}
                      size="sm"
                      type="button"
                      variant="link"
                    >
                      Open Rule
                    </Button>
                  );
                }
                if (issue.recoveryHref) {
                  return (
                    <a
                      className="ms-2 font-medium text-primary"
                      href={issue.recoveryHref}
                    >
                      {issue.recoveryLabel ?? "Resolve"}
                    </a>
                  );
                }
                return null;
              })()}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/**
 * Archiving a rule set is irreversible, so the confirmation is a real dialog:
 * the browser's `window.confirm` cannot state the consequence in Mosaic's own
 * words, cannot be styled or read as part of the page, and cannot place focus
 * on the safe choice. Focus opens on Cancel and returns to the trigger.
 */
function ArchiveRuleSetConfirmation({
  onConfirm,
  onOpenChange,
  open,
  pending,
  placementKey,
}: {
  onConfirm: () => void;
  onOpenChange: (open: boolean) => void;
  open: boolean;
  pending: boolean;
  placementKey: string;
}) {
  const cancelRef = useRef<HTMLButtonElement>(null);

  return (
    <Sheet onOpenChange={onOpenChange} open={open}>
      <SheetContent className="w-full sm:max-w-md" initialFocus={cancelRef}>
        <SheetHeader className="border-b p-5">
          <SheetTitle>Archive decision settings for {placementKey}?</SheetTitle>
          <SheetDescription>This cannot be undone.</SheetDescription>
        </SheetHeader>
        <div className="p-5">
          <p className="text-muted-foreground text-sm leading-6">
            Published versions of this Placement stay in history and keep
            serving. The active rules, outcomes, and fallbacks are removed
            permanently: restoring them means recreating every rule by hand.
            Archive the settings only when you intend to archive the Placement
            itself.
          </p>
        </div>
        <SheetFooter className="flex-row flex-wrap gap-2 border-t p-5">
          <Button
            disabled={pending}
            onClick={onConfirm}
            size="sm"
            type="button"
            variant="destructive"
          >
            {pending
              ? "Archiving decision settings…"
              : "Archive decision settings"}
          </Button>
          <Button
            disabled={pending}
            onClick={() => onOpenChange(false)}
            ref={cancelRef}
            size="sm"
            type="button"
            variant="ghost"
          >
            Keep settings
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
