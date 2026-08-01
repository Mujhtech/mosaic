import { queryOptions } from "@tanstack/react-query";

import { getHealth } from "@/generated/api/sdk.gen";
import { generatedDashboardClient } from "@/lib/api/generated-dashboard-client";

export const diagnosticsKeys = {
  apiHealth: ["diagnostics", "api-health"] as const,
};

/**
 * The liveness payload reports the serving artifact's identity alongside its
 * status (`apps/api/internal/transport/health/handler.go`). The published
 * `HealthEnvelope` schema currently declares only `status`, so the identity
 * fields are read defensively: an API that omits them simply reports nothing
 * rather than breaking the probe.
 */
export interface ApiLiveness {
  built?: string;
  commit?: string;
  status: string;
  version?: string;
}

function optionalText(value: unknown) {
  return typeof value === "string" && value.trim() !== "" ? value : undefined;
}

/**
 * Liveness probe used only by the diagnostics panel. It is deliberately not
 * retried and not refetched in the background: its purpose is to answer "can
 * this browser reach the configured API right now", once, on request.
 */
export function apiHealthQueryOptions() {
  return queryOptions({
    gcTime: 0,
    queryKey: diagnosticsKeys.apiHealth,
    queryFn: async ({ signal }): Promise<ApiLiveness> => {
      const result = await getHealth({
        client: generatedDashboardClient,
        signal,
        throwOnError: true,
      });
      const payload: Record<string, unknown> = result.data.data;
      return {
        built: optionalText(payload.built),
        commit: optionalText(payload.commit),
        status: result.data.data.status,
        version: optionalText(payload.version),
      };
    },
    retry: false,
    staleTime: 0,
  });
}
