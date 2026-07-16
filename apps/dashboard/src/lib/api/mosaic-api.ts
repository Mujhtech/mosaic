import { dashboardEnvironment } from "@/config/environment"
import { createApiClient } from "@/lib/api/client"

/**
 * Unauthenticated Phase 0 boundary. Authentication stays request-scoped when it is introduced.
 */
export const mosaicApi = createApiClient({
  baseUrl: dashboardEnvironment.apiBaseUrl,
})
