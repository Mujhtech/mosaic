import { Plus, Trash } from "@phosphor-icons/react";
import { useForm } from "@tanstack/react-form";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";

import { ErrorState } from "@/components/feedback/error-state";
import { LoadingState } from "@/components/feedback/loading-state";
import { Button } from "@/components/ui/button";
import { buttonVariants } from "@/components/ui/button-variants";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { environmentsQueryOptions } from "@/features/environments/queries/environments-query";
import { WorkflowPanel } from "@/features/orgs/components/workspace-page";
import { placementsQueryOptions } from "@/features/placements/queries/placement-queries";
import { useHostedPublishingAdapter } from "@/features/publishing/api/use-hosted-publishing-adapter";
import { useOrganizationAccess } from "@/hooks/use-organization-access";
import { describeApiError } from "@/lib/api/errors";
import { workspaceScopeParams } from "@/lib/routing/workspace-params";
import { ExperimentDraftConflictError } from "../api/experiment-adapter";
import { useExperimentAdapter } from "../api/use-experiment-adapter";
import {
  createExperimentMutationOptions,
  saveExperimentDraftMutationOptions,
} from "../mutations/experiment-mutations";
import { experimentBuilderResourcesQueryOptions } from "../queries/experiment-queries";
import {
  canSelectMetric,
  describeMetricEventFilter,
  type ExperimentDetail,
  type ExperimentScope,
  localDateTimeToUtc,
  type MetricDefinitionOption,
} from "../types/experiment";
import {
  ASSIGNMENT_IDENTITY_OPTIONS,
  buildExperimentBuilderOptions,
  buildExperimentDraftDocument,
  type ExperimentBuilderValues,
  experimentBuilderDefaultValues,
  type SelectOption,
  splitFor,
} from "./experiment-builder-support";
import { MutualExclusionGroupManager } from "./mutual-exclusion-group-manager";

interface ExperimentBuilderProps extends ExperimentScope {
  experiment?: ExperimentDetail;
  organizationId: string;
}

/**
 * The form instance is owned by `ExperimentBuilder`. The panels below are
 * presentation splits of one form, so they receive the instance rather than
 * creating their own; naming the type this way keeps that explicit without
 * spelling out TanStack Form's generic list.
 */
function useExperimentBuilderForm(
  defaultValues: ExperimentBuilderValues,
  submit: (value: ExperimentBuilderValues) => Promise<void>
) {
  return useForm({
    defaultValues,
    onSubmit: ({ value }) => submit(value),
  });
}

type ExperimentBuilderForm = ReturnType<typeof useExperimentBuilderForm>;

export function ExperimentBuilder({
  environmentId,
  experiment,
  organizationId,
  projectId,
}: ExperimentBuilderProps) {
  const scope = useMemo(
    () => ({ environmentId, projectId }),
    [environmentId, projectId]
  );
  const adapter = useExperimentAdapter();
  const publishingAdapter = useHostedPublishingAdapter();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const access = useOrganizationAccess(organizationId);
  const resources = useQuery(
    experimentBuilderResourcesQueryOptions(scope, adapter)
  );
  const environments = useQuery(environmentsQueryOptions(projectId));
  const placements = useQuery(placementsQueryOptions(scope, publishingAdapter));
  const initialVariants = experiment?.currentDraft?.variants ?? [];
  const [treatmentCount, setTreatmentCount] = useState(() =>
    Math.max(
      1,
      Math.min(
        3,
        initialVariants.filter((variant) => variant.role === "treatment")
          .length || 1
      )
    )
  );
  const [localError, setLocalError] = useState<string>();
  const [isSavingCreatedDraft, setIsSavingCreatedDraft] = useState(false);
  const createMutation = useMutation(
    createExperimentMutationOptions(scope, adapter, queryClient)
  );
  const saveMutation = useMutation(
    saveExperimentDraftMutationOptions(
      scope,
      experiment?.id ?? "new",
      adapter,
      queryClient
    )
  );
  const form = useExperimentBuilderForm(
    experimentBuilderDefaultValues(experiment),
    async (value) => {
      const document = buildExperimentDraftDocument({
        metrics: resources.data?.metrics ?? [],
        paywallVersions: resources.data?.paywallVersions ?? [],
        treatmentCount,
        value,
      });
      const target =
        experiment ??
        createMutation.data ??
        (await createMutation.mutateAsync({
          hypothesis: value.hypothesis.trim() || undefined,
          name: value.name.trim(),
          placementId: value.placementId,
        }));
      const revision =
        conflict?.currentRevision ?? target.currentDraft?.revision ?? 1;
      if (experiment) {
        await saveMutation.mutateAsync({
          document,
          expectedRevision: revision,
        });
      } else {
        setIsSavingCreatedDraft(true);
        try {
          await adapter.saveDraft(scope, target.id, document, revision);
          await queryClient.invalidateQueries({
            queryKey: ["experiments", projectId, environmentId],
          });
        } finally {
          setIsSavingCreatedDraft(false);
        }
      }
      await navigate({
        params: (prev) => ({
          ...prev,
          ...workspaceScopeParams(prev),
          experimentId: target.id,
        }),
        to: "/orgs/$organizationId/projects/$projectId/env/$environmentKey/monetization/experiments/$experimentId",
      });
    }
  );

  const handleClick = useCallback(() => {
    saveMutation.reset();
    form
      .handleSubmit()
      .catch((submitError: unknown) =>
        setLocalError(
          submitError instanceof Error
            ? submitError.message
            : "The Draft could not be saved."
        )
      );
  }, [form, saveMutation]);
  useEffect(() => {
    if (!resources.data) {
      return;
    }
    const firstVersion = resources.data.paywallVersions[0]?.id;
    const firstMetric = resources.data.metrics.find(
      (metric) => metric.eligibleAsPrimary && canSelectMetric(metric)
    )?.versionId;
    if (!form.getFieldValue("controlVersionId") && firstVersion) {
      form.setFieldValue("controlVersionId", firstVersion);
    }
    if (!form.getFieldValue("primaryMetricVersionId") && firstMetric) {
      form.setFieldValue("primaryMetricVersionId", firstMetric);
    }
  }, [form, resources.data]);

  useEffect(() => {
    const environment = environments.data?.items.find(
      (item) => item.id === environmentId
    );
    if (environment?.mode === "production") {
      form.setFieldValue("qaEnabled", false);
    }
  }, [environmentId, environments.data, form]);

  if (
    resources.isPending ||
    placements.isPending ||
    environments.isPending ||
    access.isPending
  ) {
    return (
      <LoadingState
        description="Loading eligible immutable versions, metrics, and Placements."
        title="Preparing builder"
      />
    );
  }
  if (
    resources.error ||
    placements.error ||
    environments.error ||
    access.error
  ) {
    const error =
      resources.error ?? placements.error ?? environments.error ?? access.error;
    return (
      <ErrorState
        description={describeApiError(error).description}
        onRetry={() => {
          resources.refetch();
          placements.refetch();
          environments.refetch();
        }}
      />
    );
  }
  if (!access.canManage) {
    return (
      <ErrorState
        description="Owner or admin access is required to create or change an Experiment."
        title="Read-only access"
      />
    );
  }

  const versions = resources.data.paywallVersions;
  const { groupOptions, metricOptions, placementOptions, versionOptions } =
    buildExperimentBuilderOptions({
      groups: resources.data.groups,
      metrics: resources.data.metrics,
      paywallVersions: versions,
      placements: placements.data,
    });
  const error = saveMutation.error ?? createMutation.error;
  const conflict =
    error instanceof ExperimentDraftConflictError ? error : undefined;

  return (
    <>
      <form
        className="grid gap-5"
        onSubmit={(event) => {
          event.preventDefault();
          event.stopPropagation();
          setLocalError(undefined);
          form.handleSubmit().catch((submitError: unknown) => {
            setLocalError(
              submitError instanceof Error
                ? submitError.message
                : "The Draft could not be saved."
            );
          });
        }}
      >
        <ExperimentSetupPanel
          experiment={experiment}
          form={form}
          placementOptions={placementOptions}
        />
        <VariantsPanel
          eligibleVersionCount={versions.length}
          form={form}
          onTreatmentCountChange={setTreatmentCount}
          treatmentCount={treatmentCount}
          versionOptions={versionOptions}
        />
        <AssignmentAndMetricsPanel
          experiment={experiment}
          form={form}
          groupOptions={groupOptions}
          metricOptions={metricOptions}
          metrics={resources.data.metrics}
        />
        <SchedulePanel form={form} />
        <BuilderSubmitFeedback
          conflict={conflict}
          error={error}
          localError={localError}
          onRetryConflict={handleClick}
        />
        <div className="sticky bottom-3 flex justify-end rounded border bg-background/95 p-3 shadow-sm backdrop-blur">
          <Button
            disabled={
              saveMutation.isPending ||
              createMutation.isPending ||
              isSavingCreatedDraft
            }
            type="submit"
          >
            {(() => {
              if (
                saveMutation.isPending ||
                createMutation.isPending ||
                isSavingCreatedDraft
              ) {
                return "Saving…";
              }
              if (experiment) {
                return "Save Draft revision";
              }
              return "Create Experiment Draft";
            })()}
          </Button>
        </div>
      </form>
      {experiment ? <MutualExclusionGroupManager scope={scope} /> : null}
    </>
  );
}

function BuilderSubmitFeedback({
  conflict,
  error,
  localError,
  onRetryConflict,
}: {
  conflict?: ExperimentDraftConflictError;
  error: Error | null;
  localError?: string;
  onRetryConflict: () => void;
}) {
  if (conflict) {
    return (
      <div
        className="rounded border border-destructive/40 bg-destructive/5 p-4"
        role="alert"
      >
        <h2 className="font-semibold">Draft changed on the server</h2>
        <p className="mt-1 text-muted-foreground text-sm">
          Your unsaved input is preserved. The server is at revision{" "}
          {conflict.currentRevision}. Your unsaved input is preserved. Review
          it, then retry against the latest revision in place.
        </p>
        <Button
          className="mt-3"
          onClick={onRetryConflict}
          type="button"
          variant="outline"
        >
          Save my input against revision {conflict.currentRevision}
        </Button>
      </div>
    );
  }
  if (error || localError) {
    return (
      <p className="text-destructive" role="alert">
        {error?.message ?? localError}
      </p>
    );
  }
  return null;
}

function ExperimentSetupPanel({
  experiment,
  form,
  placementOptions,
}: {
  experiment?: ExperimentDetail;
  form: ExperimentBuilderForm;
  placementOptions: readonly SelectOption[];
}) {
  return (
    <WorkflowPanel
      description="An Experiment is permanently scoped to this Environment and Placement."
      title="Experiment setup"
    >
      <div className="grid gap-4 md:grid-cols-2">
        <form.Field
          name="name"
          validators={{
            onSubmit: ({ value }) =>
              value.trim() ? undefined : "Enter an internal name.",
          }}
        >
          {(field) => (
            <Field
              data-invalid={field.state.meta.errors.length > 0 || undefined}
            >
              <FieldLabel htmlFor="experiment-name">Internal name</FieldLabel>
              <Input
                disabled={Boolean(experiment)}
                id="experiment-name"
                onBlur={field.handleBlur}
                onChange={(event) =>
                  field.handleChange(event.currentTarget.value)
                }
                value={field.state.value}
              />
              <FieldError
                errors={field.state.meta.errors.map((message) => ({
                  message,
                }))}
              />
            </Field>
          )}
        </form.Field>
        <form.Field
          name="placementId"
          validators={{
            onSubmit: ({ value }) =>
              value ? undefined : "Choose a Placement.",
          }}
        >
          {(field) => (
            <Field>
              <FieldLabel htmlFor="experiment-placement">Placement</FieldLabel>
              <Select
                items={placementOptions}
                onValueChange={(value) => field.handleChange(value)}
                value={field.state.value}
              >
                <SelectTrigger
                  disabled={Boolean(experiment)}
                  id="experiment-placement"
                  size="sm"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {placementOptions.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          )}
        </form.Field>
        <form.Field name="hypothesis">
          {(field) => (
            <Field className="md:col-span-2">
              <FieldLabel htmlFor="experiment-hypothesis">
                Hypothesis (optional)
              </FieldLabel>
              <Input
                id="experiment-hypothesis"
                onChange={(event) =>
                  field.handleChange(event.currentTarget.value)
                }
                placeholder="Clarifying annual value increases purchase starts."
                value={field.state.value}
              />
            </Field>
          )}
        </form.Field>
      </div>
    </WorkflowPanel>
  );
}

function VariantsPanel({
  eligibleVersionCount,
  form,
  onTreatmentCountChange,
  treatmentCount,
  versionOptions,
}: {
  eligibleVersionCount: number;
  form: ExperimentBuilderForm;
  onTreatmentCountChange: (count: number) => void;
  treatmentCount: number;
  versionOptions: readonly SelectOption[];
}) {
  function applyEvenSplit(nextTreatmentCount = treatmentCount) {
    for (const [index, allocation] of splitFor(
      nextTreatmentCount + 1
    ).entries()) {
      form.setFieldValue(
        `allocation${index}` as "allocation0",
        String(allocation / 100)
      );
    }
  }

  return (
    <WorkflowPanel
      description="Only exact published Paywall Versions are eligible. Drafts never appear here."
      title="Immutable Variants"
    >
      <div className="grid gap-4">
        {eligibleVersionCount === 0 ? (
          <div
            className="rounded border border-amber-600/35 bg-amber-500/5 p-4"
            role="alert"
          >
            <p className="font-semibold text-sm">
              No eligible immutable Paywall Versions
            </p>
            <p className="mt-1 text-muted-foreground text-sm">
              Publish at least two Paywall Versions in this Environment, then
              return and retry. Draft Paywalls are intentionally excluded.
            </p>
            <Link
              className={buttonVariants({
                className: "mt-3",
                size: "sm",
                variant: "outline",
              })}
              params={(prev) => ({
                ...prev,
                ...workspaceScopeParams(prev),
              })}
              to="/orgs/$organizationId/projects/$projectId/env/$environmentKey/monetization/paywalls"
            >
              Open Paywalls
            </Link>
          </div>
        ) : null}
        {Array.from({ length: treatmentCount + 1 }, (_, index) => {
          const versionField:
            | "controlVersionId"
            | "treatment1VersionId"
            | "treatment2VersionId"
            | "treatment3VersionId" = (() => {
            if (index === 0) {
              return "controlVersionId";
            }
            if (index === 1) {
              return "treatment1VersionId";
            }
            if (index === 2) {
              return "treatment2VersionId";
            }
            return "treatment3VersionId";
          })();
          const allocationField = `allocation${index}` as "allocation0";
          const role =
            index === 0
              ? "Control"
              : `Treatment ${String.fromCharCode(64 + index)}`;
          return (
            <div
              className="grid gap-3 rounded border p-4 md:grid-cols-[1fr_11rem_auto] md:items-end"
              key={role}
            >
              <form.Field name={versionField}>
                {(field) => (
                  <Field>
                    <FieldLabel htmlFor={`variant-${index}`}>
                      {role} Paywall Version
                    </FieldLabel>
                    <Select
                      items={versionOptions}
                      onValueChange={(value) => field.handleChange(value)}
                      value={field.state.value}
                    >
                      <SelectTrigger id={`variant-${index}`} size="sm">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {versionOptions.map((option) => (
                          <SelectItem key={option.value} value={option.value}>
                            {option.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </Field>
                )}
              </form.Field>
              <form.Field name={allocationField}>
                {(field) => (
                  <Field>
                    <FieldLabel htmlFor={`allocation-${index}`}>
                      Traffic split (%)
                    </FieldLabel>
                    <Input
                      id={`allocation-${index}`}
                      inputMode="decimal"
                      max="99.99"
                      min="0.01"
                      onChange={(event) =>
                        field.handleChange(event.currentTarget.value)
                      }
                      step="0.01"
                      type="number"
                      value={field.state.value}
                    />
                    <p className="text-muted-foreground text-xs">
                      {Math.round(Number(field.state.value || 0) * 100)} basis
                      points
                    </p>
                  </Field>
                )}
              </form.Field>
              {index > 1 ? (
                <Button
                  aria-label={`Remove ${role}`}
                  onClick={() => {
                    const nextCount = treatmentCount - 1;
                    onTreatmentCountChange(nextCount);
                    applyEvenSplit(nextCount);
                  }}
                  size="icon"
                  type="button"
                  variant="ghost"
                >
                  <Trash aria-hidden size={18} />
                </Button>
              ) : (
                <span />
              )}
            </div>
          );
        })}
        <div className="flex flex-wrap gap-2">
          <Button
            disabled={treatmentCount >= 3}
            onClick={() => {
              const nextCount = treatmentCount + 1;
              onTreatmentCountChange(nextCount);
              applyEvenSplit(nextCount);
            }}
            type="button"
            variant="outline"
          >
            <Plus aria-hidden size={16} /> Add Treatment
          </Button>
          <Button
            onClick={() => applyEvenSplit()}
            type="button"
            variant="outline"
          >
            Split evenly
          </Button>
        </div>
      </div>
    </WorkflowPanel>
  );
}

function AssignmentAndMetricsPanel({
  experiment,
  form,
  groupOptions,
  metricOptions,
  metrics,
}: {
  experiment?: ExperimentDetail;
  form: ExperimentBuilderForm;
  groupOptions: readonly SelectOption[];
  metricOptions: readonly (SelectOption & { disabled: boolean })[];
  metrics: readonly MetricDefinitionOption[];
}) {
  return (
    <WorkflowPanel
      description="Assignment is deterministic and offline. Results keep client-observed and provider-confirmed authorities separate."
      title="Assignment and metrics"
    >
      <div className="grid gap-4 md:grid-cols-2">
        <form.Field name="assignmentKeyPolicy">
          {(field) => (
            <Field>
              <FieldLabel htmlFor="assignment-policy">
                Assignment identity
              </FieldLabel>
              <Select
                items={ASSIGNMENT_IDENTITY_OPTIONS}
                onValueChange={(value) =>
                  field.handleChange(value as typeof field.state.value)
                }
                value={field.state.value}
              >
                <SelectTrigger id="assignment-policy" size="sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ASSIGNMENT_IDENTITY_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          )}
        </form.Field>
        <form.Field name="primaryMetricVersionId">
          {(field) => (
            <Field>
              <FieldLabel htmlFor="primary-metric">Primary metric</FieldLabel>
              <Select
                items={metricOptions}
                onValueChange={(value) => field.handleChange(value)}
                value={field.state.value}
              >
                <SelectTrigger id="primary-metric" size="sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {metricOptions.map((option) => (
                    <SelectItem
                      disabled={option.disabled}
                      key={option.value}
                      value={option.value}
                    >
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {metrics.find(
                (metric) => metric.versionId === field.state.value
              ) ? (
                <p className="text-muted-foreground text-xs">
                  Assignment unit: unique assignment key · Filter:{" "}
                  {describeMetricEventFilter(
                    metrics.find(
                      (metric) => metric.versionId === field.state.value
                    )?.eventFilter
                  )}
                </p>
              ) : (
                <p className="text-muted-foreground text-xs">
                  Unavailable metrics remain visible for diagnosis but cannot be
                  selected.
                </p>
              )}
            </Field>
          )}
        </form.Field>
        <form.Field mode="array" name="guardrailMetricVersionIds">
          {(field) => (
            <fieldset className="grid gap-2 md:col-span-2">
              <legend className="font-medium text-sm">Guardrails</legend>
              {metrics.flatMap((metric) => {
                if (!metric.eligibleAsGuardrail) {
                  return [];
                }
                const checked = field.state.value.includes(metric.versionId);
                const available = canSelectMetric(metric);
                return (
                  <label
                    className="flex items-start gap-2 text-sm"
                    key={metric.versionId}
                  >
                    <input
                      checked={checked}
                      disabled={!available}
                      onChange={() =>
                        field.handleChange(
                          checked
                            ? field.state.value.filter(
                                (id) => id !== metric.versionId
                              )
                            : [...field.state.value, metric.versionId]
                        )
                      }
                      type="checkbox"
                    />
                    <span>
                      {metric.name}
                      <span className="block text-muted-foreground text-xs">
                        {metric.definition} ·{" "}
                        {describeMetricEventFilter(metric.eventFilter)} ·{" "}
                        {available ? "available" : "trusted source unavailable"}
                      </span>
                    </span>
                  </label>
                );
              })}
            </fieldset>
          )}
        </form.Field>
        <form.Field name="mutualExclusionGroupVersionId">
          {(field) => (
            <Field className="md:col-span-2">
              <FieldLabel htmlFor="exclusion-group">
                Mutual-exclusion group
              </FieldLabel>
              <Select
                items={groupOptions}
                onValueChange={(value) => field.handleChange(value)}
                value={field.state.value}
              >
                <SelectTrigger
                  disabled={!experiment}
                  id="exclusion-group"
                  size="sm"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {groupOptions.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-muted-foreground text-xs">
                {experiment
                  ? "The selected immutable Group Version must contain this stable Experiment ID."
                  : "Create this Experiment root first. Then add its stable ID to a Group Version and return to attach that Version before publishing."}
              </p>
            </Field>
          )}
        </form.Field>
      </div>
    </WorkflowPanel>
  );
}

function SchedulePanel({ form }: { form: ExperimentBuilderForm }) {
  return (
    <WorkflowPanel
      description="Enter times in your device's local timezone. Mosaic sends the exact UTC instants shown below; start is inclusive and end is exclusive."
      title="Schedule"
    >
      <div className="grid gap-4">
        <form.Field name="scheduleMode">
          {(field) => (
            <fieldset className="grid gap-2">
              <legend className="font-medium text-sm">Start behavior</legend>
              <label className="flex items-start gap-2 text-sm">
                <input
                  checked={field.state.value === "immediate"}
                  name="schedule-mode"
                  onChange={() => field.handleChange("immediate")}
                  type="radio"
                />
                <span>
                  Start as soon as published
                  <span className="block text-muted-foreground text-xs">
                    The required start timestamp is set when you save. Actual
                    delivery cannot begin before the server publishes the
                    immutable Version.
                  </span>
                </span>
              </label>
              <label className="flex items-start gap-2 text-sm">
                <input
                  checked={field.state.value === "scheduled"}
                  name="schedule-mode"
                  onChange={() => field.handleChange("scheduled")}
                  type="radio"
                />
                <span>Schedule a local date and time</span>
              </label>
            </fieldset>
          )}
        </form.Field>
        <div className="grid gap-4 md:grid-cols-2">
          <form.Field name="startsAt">
            {(field) => (
              <Field>
                <FieldLabel htmlFor="starts-at">Start (local time)</FieldLabel>
                <Input
                  id="starts-at"
                  onChange={(event) =>
                    field.handleChange(event.currentTarget.value)
                  }
                  type="datetime-local"
                  value={field.state.value}
                />
              </Field>
            )}
          </form.Field>
          <form.Field name="endsAt">
            {(field) => (
              <Field>
                <FieldLabel htmlFor="ends-at">
                  End (local time, optional)
                </FieldLabel>
                <Input
                  id="ends-at"
                  onChange={(event) =>
                    field.handleChange(event.currentTarget.value)
                  }
                  type="datetime-local"
                  value={field.state.value}
                />
              </Field>
            )}
          </form.Field>
        </div>
        <form.Subscribe
          selector={(state) => [
            state.values.scheduleMode,
            state.values.startsAt,
            state.values.endsAt,
          ]}
        >
          {([mode, startsAtValue, endsAtValue]) => (
            <div className="rounded border bg-muted/30 p-3 text-xs">
              <p className="font-semibold">Exact UTC conversion</p>
              <p className="mt-1 text-muted-foreground">
                Start:{" "}
                {mode === "immediate"
                  ? "Set to the current instant when saved; publication is the earliest effective start."
                  : (localDateTimeToUtc(startsAtValue) ??
                    "Choose a valid local time.")}
              </p>
              <p className="text-muted-foreground">
                End: {localDateTimeToUtc(endsAtValue) ?? "No scheduled end."}
              </p>
            </div>
          )}
        </form.Subscribe>
        <p className="text-muted-foreground text-xs">
          Your current timezone is{" "}
          {Intl.DateTimeFormat().resolvedOptions().timeZone ||
            "the device timezone"}
          . Unreliable device time uses normal Placement behavior.
        </p>
      </div>
    </WorkflowPanel>
  );
}
