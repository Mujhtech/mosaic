import { useQuery } from "@tanstack/react-query"

import { environmentsQueryOptions } from "@/features/environments/queries/environments-query"
import { PaywallEditorWorkspace } from "@/features/paywall-editor/components/paywall-editor-workspace"
import type { StudioSource } from "@/features/paywall-editor/types/studio-source"

export function HostedPaywallEditorRoute({ source }: { source: StudioSource }) {
  if (source.kind !== "hosted") return null
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
