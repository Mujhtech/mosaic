import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Link } from "@tanstack/react-router"
import { useState } from "react"

import { Button } from "@/components/ui/button"
import { buttonVariants } from "@/components/ui/button-variants"
import { PublishReview } from "@/features/publishing/components/publish-review"
import { publishDraftMutationOptions } from "@/features/publishing/mutations/publish-mutation"
import { publishValidationQueryOptions } from "@/features/publishing/queries/publish-validation-query"
import { useHostedDraftSession } from "@/features/paywalls/stores/use-hosted-draft-session"
import { useHostedPublishingAdapter } from "@/features/publishing/api/use-hosted-publishing-adapter"

export function HostedPublishPanel({
  environmentId,
  environmentName,
  organizationId,
  paywallId,
  projectId,
}: {
  environmentId: string
  environmentName: string
  organizationId: string
  paywallId: string
  projectId: string
}) {
  const adapter = useHostedPublishingAdapter()
  const session = useHostedDraftSession()
  const queryClient = useQueryClient()
  const [acknowledgedRevision, setAcknowledgedRevision] = useState<number | null>(null)
  const expectedRevision = session?.draft.revision ?? 0
  const acknowledgeMockProducts = acknowledgedRevision === expectedRevision
  const validationInput = {
    draftId: session?.draft.id ?? "unavailable",
    environmentId,
    expectedRevision,
    paywallId,
    projectId,
  }
  const validation = useQuery({
    ...publishValidationQueryOptions(validationInput, adapter),
    enabled: adapter.status === "available" && !!session,
  })
  const publish = useMutation(
    publishDraftMutationOptions(
      { ...validationInput, acknowledgeMockProducts },
      adapter,
      queryClient,
    ),
  )

  if (!session) return null
  const assetsHref = `/organizations/${encodeURIComponent(organizationId)}/projects/${encodeURIComponent(projectId)}/monetization/${encodeURIComponent(environmentId)}/assets`
  const placementsHref = `/organizations/${encodeURIComponent(organizationId)}/projects/${encodeURIComponent(projectId)}/monetization/${encodeURIComponent(environmentId)}/placements`
  const catalogHref = `/organizations/${encodeURIComponent(organizationId)}/projects/${encodeURIComponent(projectId)}/catalog/products`
  const validationResult = validation.data
    ? {
        ...validation.data,
        issues: validation.data.issues.map((issue) => ({
          ...issue,
          recoveryHref:
            issue.recoveryHref ??
            (issue.code.startsWith("asset.")
              ? assetsHref
              : issue.code.startsWith("placement.")
                ? placementsHref
                : issue.code.startsWith("product.")
                  ? catalogHref
                  : undefined),
        })),
      }
    : null

  if (publish.data) {
    return (
      <section className="border-primary/25 bg-primary/5 rounded border p-4" role="status">
        <p className="text-sm font-semibold">
          Release {publish.data.number} is live in {environmentName}
        </p>
        <p className="text-muted-foreground mt-1 text-sm leading-6">
          This immutable Release is now current. Continue editing by creating a new Draft; this
          published snapshot will not change.
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <Link
            className={buttonVariants({ size: "sm" })}
            params={{ environmentId, organizationId, projectId }}
            to="/organizations/$organizationId/projects/$projectId/monetization/$environmentId/releases"
          >
            View Publish history
          </Link>
          <Link
            className={buttonVariants({ size: "sm", variant: "outline" })}
            params={{ environmentId, organizationId, paywallId, projectId }}
            to="/organizations/$organizationId/projects/$projectId/monetization/$environmentId/paywalls/$paywallId"
          >
            Open published Paywall
          </Link>
        </div>
      </section>
    )
  }

  return (
    <div className="space-y-3">
      <PublishReview
        acknowledgeMockProducts={acknowledgeMockProducts}
        environmentLabel={environmentName}
        isPublishing={publish.isPending}
        isValidating={validation.isFetching}
        onAcknowledgeMockProductsChange={(acknowledged) =>
          setAcknowledgedRevision(acknowledged ? expectedRevision : null)
        }
        onPublish={() => publish.mutate()}
        revision={session.draft.revision}
        validation={validationResult}
      />
      {validation.error ? (
        <div className="border-destructive/25 bg-destructive/5 rounded border p-3" role="alert">
          <p className="text-destructive text-sm">{validation.error.message}</p>
          <Button
            className="mt-2"
            disabled={validation.isFetching}
            onClick={() => void validation.refetch()}
            size="sm"
            type="button"
            variant="outline"
          >
            {validation.isFetching ? "Checking again…" : "Retry readiness check"}
          </Button>
        </div>
      ) : null}
      {publish.error ? (
        <div className="border-destructive/25 bg-destructive/5 rounded border p-3" role="alert">
          <p className="text-destructive text-sm" role="alert">
            {publish.error.message}
          </p>
          <Button
            className="mt-2"
            disabled={publish.isPending}
            onClick={() => publish.mutate()}
            size="sm"
            type="button"
            variant="outline"
          >
            {publish.isPending ? "Retrying…" : "Retry publish safely"}
          </Button>
        </div>
      ) : null}
    </div>
  )
}
