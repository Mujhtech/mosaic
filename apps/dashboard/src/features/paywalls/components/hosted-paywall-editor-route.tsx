import { useQuery } from "@tanstack/react-query"

import { ErrorState } from "@/components/feedback/error-state"

import { environmentsQueryOptions } from "@/features/environments/queries/environments-query"
import { PaywallEditorWorkspace } from "@/features/paywall-editor/components/paywall-editor-workspace"
import type { StudioSource } from "@/features/paywall-editor/types/studio-source"

export function HostedPaywallEditorRoute({ source }: { source: StudioSource }) {
  if (source.kind !== "hosted") {
    // Reaching this route without a hosted source means the address is
    // incomplete. Rendering nothing produced a blank Studio with no recovery.
    return (
      <ErrorState
        className="mx-auto my-10 max-w-3xl"
        description="This Studio address is missing its Organization, Project, or Environment. Reopen the Paywall from your workspace."
        title="Hosted Paywall could not be resolved"
      />
    )
  }
  return <HostedPaywallEditorWorkspace source={source} />
}

function HostedPaywallEditorWorkspace({
  source,
}: {
  source: Extract<StudioSource, { kind: "hosted" }>
}) {
  const environments = useQuery(environmentsQueryOptions(source.projectId))
  const environmentName = environments.data?.items.find(
    (environment) => environment.id === source.environmentId,
  )?.name

  return <PaywallEditorWorkspace source={{ ...source, environmentName }} />
}
