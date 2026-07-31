import { DownloadSimple, ShieldWarning, StopCircle } from "@phosphor-icons/react"
import { useForm } from "@tanstack/react-form"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Link } from "@tanstack/react-router"
import { useState } from "react"

import { ErrorState } from "@/components/feedback/error-state"
import { LiveAnnouncer } from "@/components/feedback/live-announcer"
import { LoadingState } from "@/components/feedback/loading-state"
import { Button } from "@/components/ui/button"
import { buttonVariants } from "@/components/ui/button-variants"
import { Field, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { MonetizationWorkspace } from "@/features/environments/components/monetization-workspace"
import { environmentsQueryOptions } from "@/features/environments/queries/environments-query"
import { WorkflowPanel } from "@/features/orgs/components/workspace-page"
import { useOrganizationAccess } from "@/hooks/use-organization-access"
import { cn } from "@/lib/utils"
import { useExperimentAdapter } from "../api/use-experiment-adapter"
import {
  createQaOverrideMutationOptions,
  deleteQaOverrideMutationOptions,
  emergencyStopMutationOptions,
  exportExperimentMutationOptions,
  publishExperimentMutationOptions,
  transitionExperimentMutationOptions,
  validateExperimentMutationOptions,
} from "../mutations/experiment-mutations"
import {
  experimentHistoryQueryOptions,
  experimentBuilderResourcesQueryOptions,
  experimentQaQueryOptions,
  experimentQueryOptions,
} from "../queries/experiment-queries"
import {
  canRequestExperimentExport,
  lifecycleActions,
  type ExperimentScope,
  type ExperimentStatus,
  type ExperimentDetail,
} from "../types/experiment"
import { ExperimentBuilder } from "./experiment-builder"
import { ExperimentResultsPanel } from "./experiment-results"
import { ExperimentIssueCard, ExperimentStatusBadge } from "./experiment-status"
import { MutualExclusionGroupManager } from "./mutual-exclusion-group-manager"

function formatInstant(value?: string) {
  if (!value) return "No scheduled end"
  const date = new Date(value)
  return `${date.toLocaleString()} (${date.toISOString()})`
}

function ImmutableActiveDefinition({
  environmentId,
  experiment,
  organizationId,
  projectId,
  scope,
}: {
  environmentId: string
  experiment: ExperimentDetail
  organizationId: string
  projectId: string
  scope: ExperimentScope
}) {
  const adapter = useExperimentAdapter()
  const resources = useQuery({
    ...experimentBuilderResourcesQueryOptions(scope, adapter),
    enabled: Boolean(experiment.activeDefinition),
  })
  const definition = experiment.activeDefinition
  if (!definition) {
    return (
      <WorkflowPanel title="Immutable active definition">
        <p className="text-muted-foreground text-sm">
          The API did not return an active Version definition. Use History for attribution and do
          not infer setup from the current Draft.
        </p>
      </WorkflowPanel>
    )
  }
  const primary = resources.data?.metrics.find(
    (metric) => metric.versionId === definition.primaryMetricVersionId,
  )
  const group = resources.data?.groups.find(
    (candidate) => candidate.versionId === definition.mutualExclusionGroupVersionId,
  )
  return (
    <div className="grid gap-5">
      <WorkflowPanel
        title={`Immutable active definition · Version ${experiment.activeVersionNumber ?? "unknown"}`}
        description="This is the published scientific definition used for assignment and attribution. It is read-only."
      >
        <dl className="grid gap-4 text-sm md:grid-cols-2">
          <div>
            <dt className="text-muted-foreground">Assignment identity</dt>
            <dd className="font-semibold">{definition.assignmentKeyPolicy.replaceAll("_", " ")}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Assignment algorithm</dt>
            <dd className="font-mono text-xs break-all">{definition.bucketingAlgorithm}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Allocation version</dt>
            <dd className="font-mono text-xs break-all">{definition.allocationVersion}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Source Draft revision</dt>
            <dd>{definition.sourceRevision}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Primary metric authority</dt>
            <dd className="font-semibold">
              {primary
                ? `${primary.name} · ${primary.authority.replaceAll("_", " ")}`
                : definition.primaryMetricVersionId}
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Mutual-exclusion Group Version</dt>
            <dd className="break-all">
              {definition.mutualExclusionGroupVersionId
                ? `${group?.name ? `${group.name} · ` : ""}${definition.mutualExclusionGroupVersionId}`
                : "No group"}
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Start · inclusive</dt>
            <dd>{formatInstant(definition.startsAt)}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">End · exclusive</dt>
            <dd>{formatInstant(definition.endsAt)}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Published</dt>
            <dd>{formatInstant(definition.publishedAt)}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">QA policy at publication</dt>
            <dd>
              {definition.qaPolicyEnabled === undefined
                ? "Not exposed by the active Version contract"
                : definition.qaPolicyEnabled
                  ? "Enabled"
                  : "Disabled"}
            </dd>
          </div>
        </dl>
      </WorkflowPanel>
      <WorkflowPanel title="Exact immutable Variants">
        <ul className="grid gap-3">
          {definition.variants.map((variant) => {
            const version = resources.data?.paywallVersions.find(
              (candidate) => candidate.id === variant.paywallVersionId,
            )
            return (
              <li className="rounded border p-4" key={variant.id ?? variant.paywallVersionId}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="font-semibold">
                      {variant.name} · <span className="capitalize">{variant.role}</span>
                    </p>
                    <p className="text-muted-foreground mt-1 text-sm">
                      {version
                        ? `${version.paywallName} · v${version.versionNumber}`
                        : `Paywall ${variant.paywallId}`}
                    </p>
                    <p className="text-muted-foreground mt-1 font-mono text-xs break-all">
                      Version {variant.paywallVersionId}
                    </p>
                  </div>
                  <div className="text-right text-sm">
                    <p className="font-semibold">
                      {(variant.allocationBasisPoints / 100).toFixed(2)}%
                    </p>
                    <p className="text-muted-foreground">{variant.allocationBasisPoints} bp</p>
                  </div>
                </div>
                <Link
                  className={buttonVariants({ className: "mt-3", size: "sm", variant: "outline" })}
                  params={(prev) => ({ ...prev, paywallId: variant.paywallId })}
                  to="/orgs/$organizationId/projects/$projectId/env/$environmentKey/monetization/paywalls/$paywallId"
                >
                  Open Paywall
                </Link>
              </li>
            )
          })}
        </ul>
      </WorkflowPanel>
      <WorkflowPanel title="Guardrails">
        {definition.guardrailMetricVersionIds.length ? (
          <ul className="grid gap-2 text-sm">
            {definition.guardrailMetricVersionIds.map((id) => {
              const metric = resources.data?.metrics.find((candidate) => candidate.versionId === id)
              return (
                <li className="rounded border p-3" key={id}>
                  <strong>{metric?.name ?? id}</strong>
                  <span className="text-muted-foreground block text-xs">
                    {metric
                      ? `${metric.authority.replaceAll("_", " ")} · ${metric.definition}`
                      : `Metric Version ${id}`}
                  </span>
                </li>
              )
            })}
          </ul>
        ) : (
          <p className="text-muted-foreground text-sm">No guardrails were published.</p>
        )}
      </WorkflowPanel>
      <WorkflowPanel title="Change this setup">
        <p className="text-muted-foreground text-sm">
          Active definitions cannot be edited. Create a new Experiment, using this definition as
          your review reference.
        </p>
        <Link
          className={buttonVariants({ className: "mt-3" })}
          params={(prev) => prev}
          to="/orgs/$organizationId/projects/$projectId/env/$environmentKey/monetization/experiments/new"
        >
          Create new Experiment
        </Link>
      </WorkflowPanel>
    </div>
  )
}

type WorkspaceTab = "overview" | "variants" | "metrics" | "schedule" | "results" | "history" | "qa"
const tabs: readonly { id: WorkspaceTab; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "variants", label: "Variants" },
  { id: "metrics", label: "Metrics" },
  { id: "schedule", label: "Schedule" },
  { id: "results", label: "Results" },
  { id: "history", label: "History" },
  { id: "qa", label: "QA Overrides" },
]

function LifecyclePanel({
  canManage,
  experimentId,
  scope,
  status,
}: {
  canManage: boolean
  experimentId: string
  scope: ExperimentScope
  status: ExperimentStatus
}) {
  const adapter = useExperimentAdapter()
  const queryClient = useQueryClient()
  const mutation = useMutation(
    transitionExperimentMutationOptions(scope, experimentId, adapter, queryClient),
  )
  const [target, setTarget] = useState<ExperimentStatus | "">("")
  const form = useForm({
    defaultValues: { reason: "" },
    onSubmit: async ({ value, formApi }) => {
      if (!target) return
      await mutation.mutateAsync({ reason: value.reason.trim(), target })
      setTarget("")
      formApi.reset()
    },
  })
  const actions = lifecycleActions(status)
  return (
    <WorkflowPanel
      title="Lifecycle"
      description="Each action preserves the immutable Version, records actor and reason, and publishes a new Configuration Release snapshot."
    >
      {!canManage ? (
        <p className="text-muted-foreground text-sm">
          Owner or admin access is required for lifecycle actions.
        </p>
      ) : actions.length ? (
        <form
          className="grid gap-3"
          onSubmit={(event) => {
            event.preventDefault()
            void form.handleSubmit()
          }}
        >
          <div className="flex flex-wrap gap-2">
            {actions.map((action) => (
              <Button
                key={action}
                onClick={() => setTarget(action)}
                type="button"
                variant={target === action ? "default" : "outline"}
              >
                {action === "running" && status === "paused"
                  ? "Resume"
                  : action === "running"
                    ? "Start"
                    : action}
              </Button>
            ))}
          </div>
          {target ? (
            <>
              <form.Field
                name="reason"
                validators={{
                  onSubmit: ({ value }) =>
                    value.trim().length >= 8
                      ? undefined
                      : "Provide a safe reason (at least 8 characters).",
                }}
              >
                {(field) => (
                  <Field>
                    <FieldLabel htmlFor="transition-reason">Reason for {target}</FieldLabel>
                    <Input
                      id="transition-reason"
                      value={field.state.value}
                      onChange={(event) => field.handleChange(event.currentTarget.value)}
                    />
                  </Field>
                )}
              </form.Field>
              <p className="text-muted-foreground text-xs">
                Offline devices apply this state only after accepting the new release. Mosaic does
                not claim universal immediate delivery.
              </p>
              <Button disabled={mutation.isPending} type="submit">
                {mutation.isPending ? "Applying…" : `Confirm ${target}`}
              </Button>
            </>
          ) : null}
          {mutation.error ? (
            <p className="text-destructive text-sm" role="alert">
              {mutation.error.message}
            </p>
          ) : null}
        </form>
      ) : (
        <p className="text-muted-foreground text-sm">
          This terminal state cannot return to Running.
        </p>
      )}
    </WorkflowPanel>
  )
}

function ValidationPanel({
  canManage,
  experimentId,
  revision,
  scope,
}: {
  canManage: boolean
  experimentId: string
  revision?: number
  scope: ExperimentScope
}) {
  const adapter = useExperimentAdapter()
  const queryClient = useQueryClient()
  const validation = useMutation(validateExperimentMutationOptions(scope, experimentId, adapter))
  const publish = useMutation(
    publishExperimentMutationOptions(scope, experimentId, adapter, queryClient),
  )
  return (
    <WorkflowPanel
      title="Validation and publication"
      description="Publication atomically captures immutable Variants, allocation, metric definitions, compatibility, and the release."
    >
      <div className="flex flex-wrap gap-2">
        <Button
          disabled={!canManage || validation.isPending}
          onClick={() => validation.mutate()}
          type="button"
          variant="outline"
        >
          {validation.isPending ? "Validating…" : "Validate safety"}
        </Button>
        <Button
          disabled={!canManage || !validation.data?.canPublish || !revision || publish.isPending}
          onClick={() => revision && publish.mutate(revision)}
          type="button"
        >
          {publish.isPending ? "Publishing…" : "Publish immutable Version"}
        </Button>
      </div>
      {/* The outcome is announced from a region that is always in the tree,
          because the validation result replaces content without moving focus. */}
      <LiveAnnouncer
        message={
          validation.data
            ? validation.data.issues.length
              ? `Validation found ${validation.data.issues.length} issue${validation.data.issues.length === 1 ? "" : "s"}.`
              : "Validation passed."
            : undefined
        }
      />
      {validation.data ? (
        <div className="mt-4 grid gap-3">
          {validation.data.issues.length ? (
            validation.data.issues.map((issue) => (
              <ExperimentIssueCard issue={issue} key={issue.code} />
            ))
          ) : (
            <p className="text-sm font-medium">
              Validation passed. Review the lifecycle and publish when ready.
            </p>
          )}
        </div>
      ) : null}
      {validation.error || publish.error ? (
        <p className="text-destructive mt-3 text-sm" role="alert">
          {(validation.error ?? publish.error)?.message}
        </p>
      ) : null}
    </WorkflowPanel>
  )
}

function EmergencyStopPanel({
  canManage,
  experimentId,
  scope,
  status,
}: {
  canManage: boolean
  experimentId: string
  scope: ExperimentScope
  status: ExperimentStatus
}) {
  const adapter = useExperimentAdapter()
  const queryClient = useQueryClient()
  const mutation = useMutation(
    emergencyStopMutationOptions(scope, experimentId, adapter, queryClient),
  )
  const form = useForm({
    defaultValues: { reason: "" },
    onSubmit: async ({ value }) => mutation.mutateAsync(value.reason.trim()),
  })
  if (status !== "running" && status !== "paused" && status !== "scheduled") return null
  return (
    <WorkflowPanel
      title="Emergency stop"
      description="Stops the whole Experiment, publishes normal Placement fallback, and preserves Versions, exposure, results, and history."
    >
      <form
        className="grid gap-3"
        onSubmit={(event) => {
          event.preventDefault()
          void form.handleSubmit()
        }}
      >
        <form.Field
          name="reason"
          validators={{
            onSubmit: ({ value }) =>
              value.trim().length >= 12 ? undefined : "Explain the safe operational reason.",
          }}
        >
          {(field) => (
            <Field>
              <FieldLabel htmlFor="emergency-reason">Safe reason</FieldLabel>
              <Input
                id="emergency-reason"
                value={field.state.value}
                onChange={(event) => field.handleChange(event.currentTarget.value)}
                placeholder="Treatment Product is unavailable in production."
              />
            </Field>
          )}
        </form.Field>
        <p className="text-muted-foreground text-xs">
          The stop takes effect on a device after it accepts the new release; offline devices may
          not refresh immediately.
        </p>
        <Button
          className="w-fit"
          disabled={!canManage || mutation.isPending}
          type="submit"
          variant="destructive"
        >
          <StopCircle aria-hidden size={18} />
          {mutation.isPending ? "Stopping…" : "Emergency-stop Experiment"}
        </Button>
        {mutation.error ? (
          <p className="text-destructive text-sm" role="alert">
            {mutation.error.message}
          </p>
        ) : null}
      </form>
    </WorkflowPanel>
  )
}

function HistoryPanel({
  canManage,
  canRequestIdentityExport,
  experimentId,
  scope,
}: {
  canManage: boolean
  canRequestIdentityExport: boolean
  experimentId: string
  scope: ExperimentScope
}) {
  const adapter = useExperimentAdapter()
  const history = useQuery(experimentHistoryQueryOptions(scope, experimentId, adapter))
  const exportMutation = useMutation(exportExperimentMutationOptions(scope, experimentId, adapter))
  if (history.isPending) return <LoadingState title="Loading immutable history" />
  if (history.error)
    return <ErrorState description={history.error.message} onRetry={() => void history.refetch()} />
  return (
    <div className="grid gap-5">
      <WorkflowPanel
        title="Raw event export"
        description="Exports are asynchronous, private, audited, and expire after seven days. Inputs never appear in URLs or browser storage."
      >
        <div className="flex flex-wrap gap-2">
          <Button
            disabled={!canManage || exportMutation.isPending}
            onClick={() => exportMutation.mutate(false)}
            type="button"
            variant="outline"
          >
            <DownloadSimple aria-hidden size={18} />
            Ordinary raw export
          </Button>
          <Button
            disabled={!canRequestIdentityExport || exportMutation.isPending}
            onClick={() => exportMutation.mutate(true)}
            type="button"
            variant="outline"
          >
            <ShieldWarning aria-hidden size={18} />
            Identity-scoped export (owner only)
          </Button>
        </div>
        {exportMutation.data ? (
          <p className="text-muted-foreground mt-3 text-sm" role="status">
            Export {exportMutation.data.id} is {exportMutation.data.status}. Return to Analytics
            exports to download it when complete.
          </p>
        ) : null}
        {exportMutation.error ? (
          <p className="text-destructive mt-3 text-sm" role="alert">
            {exportMutation.error.message}
          </p>
        ) : null}
      </WorkflowPanel>
      <WorkflowPanel title="Version and lifecycle history">
        <ol className="grid gap-3">
          {history.data.map((entry) => (
            <li className="rounded border p-3" key={entry.id}>
              <p className="text-sm font-medium">{entry.summary}</p>
              <p className="text-muted-foreground mt-1 text-xs">
                {new Date(entry.createdAt).toLocaleString()} · {entry.actorLabel ?? "System"}
                {entry.releaseId ? ` · Release ${entry.releaseId}` : ""}
              </p>
              {entry.reason ? <p className="mt-2 text-sm">{entry.reason}</p> : null}
            </li>
          ))}
        </ol>
      </WorkflowPanel>
    </div>
  )
}

const QA_IDENTITY_OPTIONS = [
  { label: "Identified user", value: "identified_user" },
  { label: "Installation", value: "installation" },
]

function QaPanel({
  activeVersionId,
  canManage,
  experimentId,
  isProduction,
  scope,
  variants,
}: {
  activeVersionId?: string
  canManage: boolean
  experimentId: string
  isProduction: boolean
  scope: ExperimentScope
  variants: readonly { id?: string; name: string }[]
}) {
  const adapter = useExperimentAdapter()
  const queryClient = useQueryClient()
  const qa = useQuery(experimentQaQueryOptions(scope, experimentId, adapter))
  const create = useMutation(
    createQaOverrideMutationOptions(scope, experimentId, adapter, queryClient),
  )
  const remove = useMutation(
    deleteQaOverrideMutationOptions(scope, experimentId, adapter, queryClient),
  )
  const form = useForm({
    defaultValues: {
      identityType: "identified_user" as const,
      label: "",
      variantId: variants[0]?.id ?? "",
    },
    onSubmit: async ({ value, formApi }) => {
      const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
      if (!activeVersionId) return
      await create.mutateAsync({ ...value, experimentVersionId: activeVersionId, expiresAt })
      formApi.reset()
    },
  })
  const variantOptions = variants.map((variant) => ({
    label: variant.name,
    value: variant.id ?? "",
  }))
  if (qa.isPending) return <LoadingState title="Loading QA Overrides" />
  if (qa.error)
    return <ErrorState description={qa.error.message} onRetry={() => void qa.refetch()} />
  return (
    <div className="grid gap-5">
      {isProduction ? (
        <div className="border-destructive/30 bg-destructive/5 rounded border p-4" role="alert">
          <h2 className="font-semibold">QA Overrides are prohibited in production</h2>
          <p className="text-muted-foreground mt-1 text-sm">
            A production candidate containing an override is rejected completely.
          </p>
        </div>
      ) : (
        <WorkflowPanel
          title="Create ephemeral override"
          description="Overrides expire within 24 hours, bypass allocation/schedule/group only, remain visible, and are excluded from result denominators."
        >
          <form
            className="grid gap-3 md:grid-cols-2"
            onSubmit={(event) => {
              event.preventDefault()
              void form.handleSubmit()
            }}
          >
            <form.Field name="label">
              {(field) => (
                <Field>
                  <FieldLabel htmlFor="qa-label">Safe label</FieldLabel>
                  <Input
                    id="qa-label"
                    value={field.state.value}
                    onChange={(event) => field.handleChange(event.currentTarget.value)}
                  />
                </Field>
              )}
            </form.Field>
            <form.Field name="variantId">
              {(field) => (
                <Field>
                  <FieldLabel htmlFor="qa-variant">Forced Variant</FieldLabel>
                  <Select
                    items={variantOptions}
                    onValueChange={(value) => field.handleChange(value)}
                    value={field.state.value}
                  >
                    <SelectTrigger id="qa-variant" size="sm">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {variantOptions.map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
              )}
            </form.Field>
            <form.Field name="identityType">
              {(field) => (
                <Field>
                  <FieldLabel htmlFor="qa-identity">Identity type</FieldLabel>
                  <Select
                    items={QA_IDENTITY_OPTIONS}
                    onValueChange={(value) => field.handleChange(value as "identified_user")}
                    value={field.state.value}
                  >
                    <SelectTrigger id="qa-identity" size="sm">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {QA_IDENTITY_OPTIONS.map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
              )}
            </form.Field>
            <p className="text-muted-foreground self-end text-xs">
              Mosaic creates an opaque token once. Only its one-way selector digest is retained.
            </p>
            <Button
              className="w-fit"
              disabled={!canManage || !activeVersionId || create.isPending}
              type="submit"
            >
              {create.isPending ? "Creating…" : "Create 24-hour override"}
            </Button>
          </form>
          {create.data ? (
            <div
              className="mt-4 rounded border border-amber-600/35 bg-amber-500/5 p-4"
              role="status"
            >
              <p className="text-sm font-semibold">Copy this QA token now</p>
              <p className="text-muted-foreground mt-1 text-xs">
                It is shown once and is not stored in browser storage or returned again.
              </p>
              <code className="bg-background mt-3 block overflow-x-auto rounded border p-3 text-sm">
                {create.data.token}
              </code>
              <Button
                className="mt-3"
                onClick={() => create.reset()}
                size="sm"
                type="button"
                variant="outline"
              >
                I saved the token
              </Button>
            </div>
          ) : null}
        </WorkflowPanel>
      )}
      <WorkflowPanel title="Active overrides">
        {qa.data.length ? (
          <ul className="grid gap-3">
            {qa.data.map((override) => (
              <li
                className="flex flex-wrap items-center justify-between gap-3 rounded border p-3"
                key={override.id}
              >
                <div>
                  <p className="text-sm font-medium">{override.label}</p>
                  <p className="text-muted-foreground text-xs">
                    Digest {override.visibleSelectorDigest} · expires{" "}
                    {new Date(override.expiresAt).toLocaleString()}
                  </p>
                </div>
                <Button
                  aria-label={`Delete QA Override ${override.label}`}
                  disabled={!canManage || remove.isPending}
                  onClick={() => remove.mutate(override.id)}
                  size="sm"
                  type="button"
                  variant="ghost"
                >
                  Delete
                </Button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-muted-foreground text-sm">No active overrides.</p>
        )}
      </WorkflowPanel>
    </div>
  )
}

export function ExperimentWorkspace({
  environmentId,
  experimentId,
  organizationId,
  projectId,
}: {
  environmentId: string
  experimentId: string
  organizationId: string
  projectId: string
}) {
  const scope = { environmentId, projectId }
  const adapter = useExperimentAdapter()
  const experiment = useQuery(experimentQueryOptions(scope, experimentId, adapter))
  const environments = useQuery(environmentsQueryOptions(projectId))
  const access = useOrganizationAccess(organizationId)
  const [tab, setTab] = useState<WorkspaceTab>("overview")
  if (experiment.isPending || environments.isPending || access.isPending)
    return (
      <MonetizationWorkspace
        description="Loading Experiment workspace."
        environmentId={environmentId}
        organizationId={organizationId}
        projectId={projectId}
        surface="experiments"
        title="Experiment"
      >
        <LoadingState title="Loading Experiment" />
      </MonetizationWorkspace>
    )
  if (experiment.error || !experiment.data)
    return (
      <MonetizationWorkspace
        description="The Experiment could not be loaded safely."
        environmentId={environmentId}
        organizationId={organizationId}
        projectId={projectId}
        surface="experiments"
        title="Experiment"
      >
        <ErrorState
          description={experiment.error?.message}
          onRetry={() => void experiment.refetch()}
        />
      </MonetizationWorkspace>
    )
  const item = experiment.data
  const draft = item.currentDraft
  const environment = environments.data?.items.find((candidate) => candidate.id === environmentId)
  return (
    <MonetizationWorkspace
      actions={<ExperimentStatusBadge status={item.status} />}
      description="Immutable scientific definition, lifecycle, safety, and uncertainty remain together in this Environment-owned workspace."
      environmentId={environmentId}
      organizationId={organizationId}
      projectId={projectId}
      surface="experiments"
      title={item.name}
    >
      <nav aria-label="Experiment workspace" className="flex flex-wrap gap-1 border-b">
        {tabs.map((candidate) => (
          <button
            aria-current={tab === candidate.id ? "page" : undefined}
            className={cn(
              "focus-visible:ring-ring rounded-t px-3 py-2 text-sm font-medium focus-visible:ring-2 focus-visible:outline-none",
              tab === candidate.id
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:bg-muted",
            )}
            key={candidate.id}
            onClick={() => setTab(candidate.id)}
            type="button"
          >
            {candidate.label}
          </button>
        ))}
      </nav>
      {tab === "overview" ? (
        <div className="grid gap-5">
          <WorkflowPanel title="Scientific definition">
            <dl className="grid gap-4 text-sm sm:grid-cols-2">
              <div>
                <dt className="text-muted-foreground">Placement</dt>
                <dd className="font-semibold">{item.placementName}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Active Version</dt>
                <dd className="font-semibold">{item.activeVersionNumber ?? "Not published"}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Assignment identity</dt>
                <dd>
                  {draft?.assignmentKeyPolicy.replaceAll("_", " ") ?? "Captured in active Version"}
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Draft revision</dt>
                <dd>{draft?.revision ?? "No editable Draft"}</dd>
              </div>
            </dl>
          </WorkflowPanel>
          <ValidationPanel
            canManage={access.canManage}
            experimentId={experimentId}
            revision={draft?.revision}
            scope={scope}
          />
          {access.canManage ? <MutualExclusionGroupManager scope={scope} /> : null}
          <LifecyclePanel
            canManage={access.canManage}
            experimentId={experimentId}
            scope={scope}
            status={item.status}
          />
          <EmergencyStopPanel
            canManage={access.canManage}
            experimentId={experimentId}
            scope={scope}
            status={item.status}
          />
        </div>
      ) : null}
      {tab === "variants" || tab === "metrics" || tab === "schedule" ? (
        draft && item.status === "draft" ? (
          <ExperimentBuilder
            environmentId={environmentId}
            experiment={item}
            organizationId={organizationId}
            projectId={projectId}
          />
        ) : (
          <ImmutableActiveDefinition
            environmentId={environmentId}
            experiment={item}
            organizationId={organizationId}
            projectId={projectId}
            scope={scope}
          />
        )
      ) : null}
      {tab === "results" ? (
        <ExperimentResultsPanel experimentId={experimentId} scope={scope} />
      ) : null}
      {tab === "history" ? (
        <HistoryPanel
          canManage={canRequestExperimentExport(access.role, false)}
          canRequestIdentityExport={canRequestExperimentExport(access.role, true)}
          experimentId={experimentId}
          scope={scope}
        />
      ) : null}
      {tab === "qa" ? (
        <QaPanel
          activeVersionId={item.activeVersionId}
          canManage={access.canManage}
          experimentId={experimentId}
          isProduction={environment?.mode === "production"}
          scope={scope}
          variants={item.activeVariants ?? draft?.variants ?? []}
        />
      ) : null}
    </MonetizationWorkspace>
  )
}
