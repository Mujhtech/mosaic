import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";

import { EmptyState } from "@/components/feedback/empty-state";
import { Button } from "@/components/ui/button";
import { buttonVariants } from "@/components/ui/button-variants";
import { hostedStudioPublishReviewHref } from "@/features/paywall-editor/types/studio-source";
import { useHostedDraftSession } from "@/features/paywalls/stores/use-hosted-draft-session";
import { useHostedPublishingAdapter } from "@/features/publishing/api/use-hosted-publishing-adapter";
import { PublishReview } from "@/features/publishing/components/publish-review";
import { publishDraftMutationOptions } from "@/features/publishing/mutations/publish-mutation";
import { publishValidationQueryOptions } from "@/features/publishing/queries/publish-validation-query";
import {
  publishRecoveryHref,
  publishRecoveryLabel,
} from "@/features/publishing/types/publish-recovery";
import { describeApiError } from "@/lib/api/errors";
import { workspaceScopeParams } from "@/lib/routing/workspace-params";

type HostedDraftSession = NonNullable<ReturnType<typeof useHostedDraftSession>>;

interface HostedPublishPanelProps {
  environmentId: string;
  environmentName: string;
  organizationId: string;
  paywallId: string;
  projectId: string;
}

/**
 * Publishing is bound to the exact Draft revision it was reviewed against, so
 * the session check happens here — before any hook can build a request out of
 * it. The panel used to substitute `expectedRevision: 0` while the session was
 * absent, which is a real revision number, not a placeholder: it is what a
 * never-saved Draft has.
 */
export function HostedPublishPanel(props: HostedPublishPanelProps) {
  const session = useHostedDraftSession();

  if (!session) {
    // A missing Draft session is a real, recoverable condition (the Draft was
    // published, discarded, or never loaded). Silently rendering nothing left
    // the publish panel looking broken.
    return (
      <EmptyState
        description="Open or create a Draft for this Paywall to review and publish it."
        title="No Draft is loaded"
      />
    );
  }

  return <HostedPublishPanelForSession {...props} session={session} />;
}

function HostedPublishPanelForSession({
  environmentId,
  environmentName,
  organizationId,
  paywallId,
  projectId,
  session,
}: HostedPublishPanelProps & { session: HostedDraftSession }) {
  const adapter = useHostedPublishingAdapter();
  const queryClient = useQueryClient();
  const [acknowledgedRevision, setAcknowledgedRevision] = useState<
    number | null
  >(null);
  const expectedRevision = session.draft.revision;
  const acknowledgeMockProducts = acknowledgedRevision === expectedRevision;
  const validationInput = {
    draftId: session.draft.id,
    environmentId,
    expectedRevision,
    paywallId,
    projectId,
  };
  const validation = useQuery({
    ...publishValidationQueryOptions(validationInput, adapter),
    enabled: adapter.status === "available",
  });
  const publish = useMutation(
    publishDraftMutationOptions(
      { ...validationInput, acknowledgeMockProducts },
      adapter,
      queryClient
    )
  );

  const assetsHref = `/orgs/${encodeURIComponent(organizationId)}/projects/${encodeURIComponent(projectId)}/monetization/${encodeURIComponent(environmentId)}/assets`;
  const placementsHref = `/orgs/${encodeURIComponent(organizationId)}/projects/${encodeURIComponent(projectId)}/monetization/${encodeURIComponent(environmentId)}/placements`;
  const catalogHref = `/orgs/${encodeURIComponent(organizationId)}/projects/${encodeURIComponent(projectId)}/catalog/products`;
  const providersHref = `/orgs/${encodeURIComponent(organizationId)}/projects/${encodeURIComponent(projectId)}/catalog/providers`;
  const returnTo = hostedStudioPublishReviewHref({
    draftId: session.draft.id,
    environmentId,
    kind: "hosted",
    organizationId,
    paywallId,
    projectId,
  });
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
    : null;

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
    );
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
        <div
          className="rounded border border-destructive/25 bg-destructive/5 p-3"
          role="alert"
        >
          <p className="text-destructive text-sm">
            {describeApiError(validation.error).description}
          </p>
          <Button
            className="mt-2"
            disabled={validation.isFetching}
            onClick={() => {
              validation.refetch();
            }}
            size="sm"
            type="button"
            variant="outline"
          >
            {validation.isFetching
              ? "Checking again…"
              : "Retry readiness check"}
          </Button>
        </div>
      ) : null}
      {publish.error ? (
        <div
          className="rounded border border-destructive/25 bg-destructive/5 p-3"
          role="alert"
        >
          <p className="text-destructive text-sm">
            {describeApiError(publish.error).description}
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
  );
}

/**
 * Publishing replaces the trigger with this confirmation, so keyboard focus
 * would otherwise fall back to the document body. The section receives focus
 * explicitly, keeping the follow-up actions reachable.
 */
function PublishSuccessPanel({
  environmentName,
  paywallId,
  releaseNumber,
}: {
  environmentId: string;
  environmentName: string;
  organizationId: string;
  paywallId: string;
  projectId: string;
  releaseNumber: number;
}) {
  const sectionRef = useRef<HTMLElement>(null);

  useEffect(() => {
    sectionRef.current?.focus();
  }, []);

  return (
    <section
      className="rounded border border-primary/25 bg-primary/5 p-4"
      ref={sectionRef}
      role="status"
      tabIndex={-1}
    >
      <p className="font-semibold text-sm">
        Release {releaseNumber} is live in {environmentName}
      </p>
      <p className="mt-1 text-muted-foreground text-sm leading-6">
        This immutable Release is now current. Continue editing by creating a
        new Draft; this published snapshot will not change.
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <Link
          className={buttonVariants({ size: "sm" })}
          params={(prev) => ({
            ...prev,
            ...workspaceScopeParams(prev),
          })}
          to="/orgs/$organizationId/projects/$projectId/env/$environmentKey/monetization/releases"
        >
          View Publish history
        </Link>
        <Link
          className={buttonVariants({ size: "sm", variant: "outline" })}
          params={(prev) => ({
            ...prev,
            ...workspaceScopeParams(prev),
            paywallId,
          })}
          to="/orgs/$organizationId/projects/$projectId/env/$environmentKey/monetization/paywalls/$paywallId"
        >
          Open published Paywall
        </Link>
      </div>
    </section>
  );
}
