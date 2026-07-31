import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Link } from "@tanstack/react-router"
import { useEffect, useRef, useState } from "react"

import { EmptyState } from "@/components/feedback/empty-state"
import { Button } from "@/components/ui/button"
import { describeApiError } from "@/lib/api/errors"
import { buttonVariants } from "@/components/ui/button-variants"
import { PublishReview } from "@/features/publishing/components/publish-review"
import { publishDraftMutationOptions } from "@/features/publishing/mutations/publish-mutation"
import { publishValidationQueryOptions } from "@/features/publishing/queries/publish-validation-query"
import { useHostedDraftSession } from "@/features/paywalls/stores/use-hosted-draft-session"
import { useHostedPublishingAdapter } from "@/features/publishing/api/use-hosted-publishing-adapter"
import {
  publishRecoveryHref,
  publishRecoveryLabel,
} from "@/features/publishing/types/publish-recovery"
import { hostedStudioPublishReviewHref } from "@/features/paywall-editor/types/studio-source"

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

  if (!session) {
    // A missing Draft session is a real, recoverable condition (the Draft was
    // published, discarded, or never loaded). Silently rendering nothing left
    // the publish panel looking broken.
    return (
      <EmptyState
        description="Open or create a Draft for this Paywall to review and publish it."
        title="No Draft is loaded"
      />
    )
  }
  const assetsHref = `/orgs/${encodeURIComponent(organizationId)}/projects/${encodeURIComponent(projectId)}/monetization/${encodeURIComponent(environmentId)}/assets`
  const placementsHref = `/orgs/${encodeURIComponent(organizationId)}/projects/${encodeURIComponent(projectId)}/monetization/${encodeURIComponent(environmentId)}/placements`
  const catalogHref = `/orgs/${encodeURIComponent(organizationId)}/projects/${encodeURIComponent(projectId)}/catalog/products`
  const providersHref = `/orgs/${encodeURIComponent(organizationId)}/projects/${encodeURIComponent(projectId)}/catalog/providers`
  const returnTo = hostedStudioPublishReviewHref({
    draftId: session.draft.id,
    environmentId,
    kind: "hosted",
    organizationId,
    paywallId,
    projectId,
  })
  const validationResult = validation.data
    ? {
        ...validation.data,
        issues: validation.data.issues.map((issue) => ({
          ...issue,
          recoveryHref: publishRecoveryHref(issue, {
            assetsHref,
            catalogHref,
            environmentId,
            organizationId,
            placementsHref,
            projectId,
            providersHref,
            returnTo,
          }),
          recoveryLabel: publishRecoveryLabel(issue),
        })),
      }
    : null

  if (publish.data) {
    return (
      <PublishSuccessPanel
        environmentId={environmentId}
        environmentName={environmentName}
        organizationId={organizationId}
        paywallId={paywallId}
        projectId={projectId}
        releaseNumber={publish.data.number}
      />
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
          <p className="text-destructive text-sm">
            {describeApiError(validation.error).description}
          </p>
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
          <p className="text-destructive text-sm">{describeApiError(publish.error).description}</p>
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

/**
 * Publishing replaces the trigger with this confirmation, so keyboard focus
 * would otherwise fall back to the document body. The section receives focus
 * explicitly, keeping the follow-up actions reachable.
 */
function PublishSuccessPanel({
  environmentId,
  environmentName,
  organizationId,
  paywallId,
  projectId,
  releaseNumber,
}: {
  environmentId: string
  environmentName: string
  organizationId: string
  paywallId: string
  projectId: string
  releaseNumber: number
}) {
  const sectionRef = useRef<HTMLElement>(null)

  useEffect(() => {
    sectionRef.current?.focus()
  }, [])

  return (
    <section
      className="border-primary/25 bg-primary/5 rounded border p-4"
      ref={sectionRef}
      role="status"
      tabIndex={-1}
    >
      <p className="text-sm font-semibold">
        Release {releaseNumber} is live in {environmentName}
      </p>
      <p className="text-muted-foreground mt-1 text-sm leading-6">
        This immutable Release is now current. Continue editing by creating a new Draft; this
        published snapshot will not change.
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <Link
          className={buttonVariants({ size: "sm" })}
          params={(prev) => prev}
          to="/orgs/$organizationId/projects/$projectId/env/$environmentKey/monetization/releases"
        >
          View Publish history
        </Link>
        <Link
          className={buttonVariants({ size: "sm", variant: "outline" })}
          params={(prev) => ({ ...prev, paywallId })}
          to="/orgs/$organizationId/projects/$projectId/env/$environmentKey/monetization/paywalls/$paywallId"
        >
          Open published Paywall
        </Link>
      </div>
    </section>
  )
}
