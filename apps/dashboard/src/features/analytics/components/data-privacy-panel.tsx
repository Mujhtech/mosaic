import { useForm } from "@tanstack/react-form"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useState } from "react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { WorkflowPanel } from "@/features/orgs/components/workspace-page"
import type { AnalyticsAdapter } from "../api/analytics-adapter"
import { analyticsKeys, jobQueryOptions, settingsQueryOptions } from "../queries/analytics-queries"
import type {
  AnalyticsRole,
  AnalyticsScope,
  AsyncJob,
  IdentityPreview,
  IdentityRequest,
} from "../types/analytics"
import { AnalyticsQueryResult } from "./query-result"

export function DataPrivacyPanel({
  adapter,
  role,
  scope,
}: {
  adapter: AnalyticsAdapter
  role?: AnalyticsRole
  scope: AnalyticsScope
}) {
  return (
    <div className="space-y-5">
      <CollectionSettingsPanel adapter={adapter} role={role} scope={scope} />
      <IdentityOperationsPanel adapter={adapter} role={role} scope={scope} />
    </div>
  )
}

function CollectionSettingsPanel({
  adapter,
  role,
  scope,
}: {
  adapter: AnalyticsAdapter
  role?: AnalyticsRole
  scope: AnalyticsScope
}) {
  const queryClient = useQueryClient()
  const settings = useQuery(settingsQueryOptions(scope, adapter))
  const canManage = role === "owner" || role === "admin"
  const mutation = useMutation({
    mutationFn: (next: { enabled: boolean; rawRetentionDays: number }) =>
      adapter.updateCollectionSettings(scope, next),
    onSuccess: (data) =>
      queryClient.setQueryData([...analyticsKeys.settings(scope), adapter], data),
  })
  return (
    <WorkflowPanel
      description="Collection starts disabled. Retention is Environment-scoped and enforced from received time."
      title="Collection and retention"
    >
      <AnalyticsQueryResult
        error={settings.error}
        isPending={settings.isPending}
        onRetry={() => void settings.refetch()}
      >
        {settings.data ? (
          <form
            className="grid gap-4 sm:grid-cols-2"
            onSubmit={(event) => {
              event.preventDefault()
              const data = new FormData(event.currentTarget)
              mutation.mutate({
                enabled: data.get("enabled") === "on",
                rawRetentionDays: Number(data.get("retention")),
              })
            }}
          >
            <label className="border-border flex items-start gap-3 rounded border p-4 text-sm">
              <input
                defaultChecked={settings.data.enabled}
                disabled={!canManage || mutation.isPending}
                name="enabled"
                type="checkbox"
              />
              <span>
                <span className="block font-medium">Collect analytics</span>
                <span className="text-muted-foreground mt-1 block text-xs">
                  Disabling stops new events and clears unsent SDK queues. Re-enabling starts a new
                  session.
                </span>
              </span>
            </label>
            <label className="space-y-1 text-sm font-medium">
              Raw event retention
              <select
                className="border-input bg-background h-10 w-full rounded border px-3"
                defaultValue={settings.data.rawRetentionDays}
                disabled={!canManage || mutation.isPending}
                name="retention"
              >
                {[30, 60, 90, 180, 365, 730].map((days) => (
                  <option key={days} value={days}>
                    {days} days{days === 180 ? " (default)" : ""}
                  </option>
                ))}
              </select>
            </label>
            <p className="text-muted-foreground text-xs sm:col-span-2">
              Exact aggregates and privacy audit metadata are retained for 24 months. Retention
              changes apply to raw events received after the setting is saved.
            </p>
            {canManage ? (
              <Button className="w-fit" disabled={mutation.isPending} type="submit">
                {mutation.isPending ? "Saving…" : "Save settings"}
              </Button>
            ) : (
              <p className="text-muted-foreground text-sm">
                Owner or admin permission is required to change collection and retention.
              </p>
            )}
            {mutation.isSuccess ? (
              <p className="text-primary self-center text-sm" role="status">
                Settings saved.
              </p>
            ) : null}
            {mutation.error ? (
              <p className="text-destructive self-center text-sm" role="alert">
                {mutation.error.message}
              </p>
            ) : null}
          </form>
        ) : null}
      </AnalyticsQueryResult>
    </WorkflowPanel>
  )
}

function IdentityOperationsPanel({
  adapter,
  role,
  scope,
}: {
  adapter: AnalyticsAdapter
  role?: AnalyticsRole
  scope: AnalyticsScope
}) {
  const [mode, setMode] = useState<"export" | "delete">("export")
  const [preview, setPreview] = useState<IdentityPreview>()
  const [identityRequest, setIdentityRequest] = useState<IdentityRequest>()
  const [job, setJob] = useState<AsyncJob>()
  const previewMutation = useMutation({
    mutationFn: (request: IdentityRequest) =>
      mode === "export"
        ? adapter.previewIdentity(scope, request)
        : adapter.previewDeletion(scope, request),
    onSuccess: (data) => {
      setPreview(data)
      setJob(undefined)
    },
  })
  const exportMutation = useMutation({
    mutationFn: (request: IdentityRequest) => adapter.createIdentityExport(scope, request),
    onSuccess: setJob,
  })
  const deletionMutation = useMutation({
    mutationFn: ({ request, requestDigest }: { request: IdentityRequest; requestDigest: string }) =>
      adapter.confirmDeletion(scope, request, requestDigest),
    onSuccess: setJob,
  })
  const downloadMutation = useMutation({
    mutationFn: async () => {
      if (!job?.id) throw new Error("The private export job is unavailable.")
      return adapter.downloadJob(scope, job.id)
    },
    onSuccess: (blob) => downloadBlob(blob, "mosaic-identity-export.ndjson"),
  })
  const jobQuery = useQuery({
    ...jobQueryOptions(scope, job?.id ?? "", adapter),
    enabled: Boolean(job?.id),
  })
  const form = useForm({
    defaultValues: {
      scope: "application_user" as IdentityRequest["scope"],
      value: "",
      confirmation: "",
    },
    onSubmit: async ({ value }) => {
      if (!value.value.trim()) return
      const request = { scope: value.scope, value: value.value.trim() }
      setIdentityRequest(request)
      await previewMutation.mutateAsync(request)
    },
  })

  if (role !== "owner") {
    return (
      <WorkflowPanel title="Identity privacy">
        <p className="text-muted-foreground text-sm">
          Only organization owners can search identities, export user data, or request deletion.
        </p>
      </WorkflowPanel>
    )
  }

  return (
    <WorkflowPanel
      description="Identity input is sent only in POST bodies and is never added to URLs, query keys, browser storage, logs, or filenames."
      title="Identity privacy"
    >
      <div className="space-y-5">
        <div aria-label="Privacy operation" className="flex gap-2" role="group">
          <Button
            onClick={() => {
              setMode("export")
              setPreview(undefined)
              setJob(undefined)
            }}
            type="button"
            variant={mode === "export" ? "default" : "outline"}
          >
            Export
          </Button>
          <Button
            onClick={() => {
              setMode("delete")
              setPreview(undefined)
              setJob(undefined)
            }}
            type="button"
            variant={mode === "delete" ? "destructive" : "outline"}
          >
            Delete
          </Button>
        </div>
        <form
          className="grid gap-4 sm:grid-cols-[12rem_1fr_auto]"
          onSubmit={(event) => {
            event.preventDefault()
            event.stopPropagation()
            void form.handleSubmit()
          }}
        >
          <form.Field name="scope">
            {(field) => (
              <label className="space-y-1 text-sm font-medium">
                Identity scope
                <select
                  className="border-input bg-background h-10 w-full rounded border px-3"
                  onChange={(event) =>
                    field.handleChange(event.target.value as IdentityRequest["scope"])
                  }
                  value={field.state.value}
                >
                  <option value="application_user">Application user</option>
                  <option value="installation">Installation</option>
                </select>
              </label>
            )}
          </form.Field>
          <form.Field name="value">
            {(field) => (
              <label className="space-y-1 text-sm font-medium">
                Opaque identity
                <Input
                  autoComplete="off"
                  maxLength={256}
                  name="identity-value"
                  onChange={(event) => field.handleChange(event.target.value)}
                  placeholder="Exact opaque identifier"
                  required
                  spellCheck={false}
                  type="text"
                  value={field.state.value}
                />
              </label>
            )}
          </form.Field>
          <Button className="self-end" disabled={previewMutation.isPending} type="submit">
            {previewMutation.isPending ? "Previewing…" : "Preview affected data"}
          </Button>
        </form>
        {previewMutation.error ? (
          <p className="text-destructive text-sm" role="alert">
            {previewMutation.error.message}
          </p>
        ) : null}
        {preview && identityRequest ? (
          <PreviewConfirmation
            deletionMutation={deletionMutation}
            exportMutation={exportMutation}
            identityRequest={identityRequest}
            mode={mode}
            preview={preview}
          />
        ) : null}
        {job ? (
          <JobStatus
            job={jobQuery.data ?? job}
            onDownload={() => downloadMutation.mutate()}
            onRetry={() =>
              preview &&
              identityRequest &&
              (mode === "export"
                ? exportMutation.mutate(identityRequest)
                : deletionMutation.mutate({
                    request: identityRequest,
                    requestDigest: preview.requestToken,
                  }))
            }
          />
        ) : null}
        {downloadMutation.error ? (
          <p className="text-destructive text-sm" role="alert">
            {downloadMutation.error.message}
          </p>
        ) : null}
      </div>
    </WorkflowPanel>
  )
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement("a")
  anchor.href = url
  anchor.download = filename
  anchor.click()
  URL.revokeObjectURL(url)
}

function PreviewConfirmation({
  deletionMutation,
  exportMutation,
  identityRequest,
  mode,
  preview,
}: {
  deletionMutation: ReturnType<
    typeof useMutation<AsyncJob, Error, { request: IdentityRequest; requestDigest: string }>
  >
  exportMutation: ReturnType<typeof useMutation<AsyncJob, Error, IdentityRequest>>
  identityRequest: IdentityRequest
  mode: "export" | "delete"
  preview: IdentityPreview
}) {
  const [confirmation, setConfirmation] = useState("")
  return (
    <section aria-labelledby="affected-data-title" className="border-border rounded border p-4">
      <h3 className="font-semibold" id="affected-data-title">
        Affected-data preview
      </h3>
      <p className="text-muted-foreground mt-1 text-sm">
        {preview.eventCount.toLocaleString()} events, {preview.sessionCount.toLocaleString()}{" "}
        sessions, and {preview.relationshipCount.toLocaleString()} identity relationships across{" "}
        {preview.affectedEnvironments.length} Environment(s).
      </p>
      <ul className="mt-3 space-y-1 text-sm">
        {preview.affectedEnvironments.map((environment) => (
          <li key={environment.id}>{environment.name}</li>
        ))}
      </ul>
      {mode === "export" ? (
        <Button
          className="mt-4"
          disabled={exportMutation.isPending}
          onClick={() => exportMutation.mutate(identityRequest)}
          type="button"
        >
          {exportMutation.isPending ? "Starting…" : "Confirm private export"}
        </Button>
      ) : (
        <div className="mt-4 space-y-3">
          <p className="text-destructive text-sm">
            Deletion hard-deletes matching raw events, sessions, and identity links, then recomputes
            affected aggregates. Audit metadata retains no raw identity.
          </p>
          <label className="block max-w-sm space-y-1 text-sm font-medium">
            Type DELETE to confirm
            <Input
              autoComplete="off"
              onChange={(event) => setConfirmation(event.target.value)}
              value={confirmation}
            />
          </label>
          <Button
            disabled={confirmation !== "DELETE" || deletionMutation.isPending}
            onClick={() =>
              deletionMutation.mutate({
                request: identityRequest,
                requestDigest: preview.requestToken,
              })
            }
            type="button"
            variant="destructive"
          >
            {deletionMutation.isPending ? "Requesting deletion…" : "Confirm deletion"}
          </Button>
        </div>
      )}
      {exportMutation.error || deletionMutation.error ? (
        <p className="text-destructive mt-3 text-sm" role="alert">
          {(exportMutation.error ?? deletionMutation.error)?.message}
        </p>
      ) : null}
    </section>
  )
}

export function JobStatus({
  job,
  onDownload,
  onRetry,
}: {
  job: AsyncJob
  onDownload: () => void
  onRetry: () => void
}) {
  return (
    <section aria-live="polite" className="bg-muted/30 rounded border p-4">
      <h3 className="font-semibold">
        {job.type.replaceAll("_", " ")} · {job.state}
      </h3>
      {job.state === "completed" ? (
        <>
          <p className="text-muted-foreground mt-1 text-sm">
            {job.auditSummary ?? "Operation completed with an auditable summary."}
          </p>
          {job.downloadAvailable ? (
            <Button className="mt-3" onClick={onDownload} type="button" variant="outline">
              Download private export
            </Button>
          ) : null}
        </>
      ) : null}
      {job.state === "failed" ? (
        <>
          <p className="text-destructive mt-1 text-sm" role="alert">
            Operation failed safely: {job.safeErrorCode ?? "unknown_error"}.
          </p>
          <Button className="mt-3" onClick={onRetry} type="button" variant="outline">
            Start recovery
          </Button>
        </>
      ) : (
        <p className="text-muted-foreground mt-1 text-sm">
          {job.state === "queued" || job.state === "leased"
            ? "Mosaic is processing this request. This status refreshes automatically."
            : ""}
        </p>
      )}
    </section>
  )
}
