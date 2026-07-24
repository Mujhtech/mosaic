import type { PublishValidationIssue } from "@/features/publishing/api/hosted-publishing-adapter"
import {
  providerRecoveryDescriptor,
  type ProviderRecoveryDestination,
} from "@/features/catalog/types/provider-recovery"

interface PublishRecoveryContext {
  assetsHref: string
  catalogHref: string
  environmentId: string
  organizationId: string
  placementsHref: string
  projectId: string
  providersHref: string
  returnTo?: string
}

function appendSearch(href: string, values: Record<string, string | undefined>) {
  if (!href.startsWith("/")) return href
  const url = new URL(href, "https://mosaic.local")
  for (const [key, value] of Object.entries(values)) {
    if (value) url.searchParams.set(key, value)
  }
  return `${url.pathname}${url.search}${url.hash}`
}

function productHref(context: PublishRecoveryContext, issue: PublishValidationIssue) {
  if (!issue.productId) {
    return appendSearch(context.catalogHref, { returnTo: context.returnTo })
  }

  const base = `/organizations/${encodeURIComponent(context.organizationId)}/projects/${encodeURIComponent(context.projectId)}/catalog/products/${encodeURIComponent(issue.productId)}`
  const search = new URLSearchParams()
  search.set("environmentId", issue.environmentId ?? context.environmentId)
  if (issue.applicationId) search.set("applicationId", issue.applicationId)
  if (context.returnTo) search.set("returnTo", context.returnTo)
  return `${base}?${search.toString()}`
}

export function publishRecoveryHref(
  issue: PublishValidationIssue,
  context: PublishRecoveryContext,
) {
  if (issue.recoveryHref) {
    return appendSearch(issue.recoveryHref, { returnTo: context.returnTo })
  }
  if (issue.recoveryAction) {
    const destination = providerRecoveryDescriptor(issue.recoveryAction).destination
    const destinations: Record<ProviderRecoveryDestination, string> = {
      access: `${productHref(context, issue)}#access-grants-title`,
      applications: `/organizations/${encodeURIComponent(context.organizationId)}/projects/${encodeURIComponent(context.projectId)}/apps`,
      lifecycle: `${productHref(context, issue)}#lifecycle-title`,
      mapping: `${productHref(context, issue)}#provider-mappings-title`,
      providers: appendSearch(context.providersHref, {
        environmentId: issue.environmentId ?? context.environmentId,
        returnTo: context.returnTo,
      }),
    }
    return destinations[destination]
  }
  if (issue.code.startsWith("asset.")) {
    return appendSearch(context.assetsHref, { returnTo: context.returnTo })
  }
  if (issue.code.startsWith("placement.")) {
    return appendSearch(context.placementsHref, { returnTo: context.returnTo })
  }

  if (
    issue.resourceType === "provider_assignment" ||
    issue.resourceType === "provider_connection" ||
    issue.code.startsWith("provider.") ||
    issue.code.startsWith("commerce.provider.") ||
    issue.code === "connectionRevoked" ||
    issue.code === "credentialExpired" ||
    issue.code === "credentialInvalid" ||
    issue.code === "modeMismatch" ||
    issue.code === "permissionDenied" ||
    issue.code === "providerUnavailable" ||
    issue.code === "scopeMismatch" ||
    issue.code.includes("active_provider") ||
    issue.code.includes("connection")
  ) {
    return appendSearch(context.providersHref, {
      environmentId: issue.environmentId ?? context.environmentId,
      returnTo: context.returnTo,
    })
  }

  if (
    issue.resourceType === "product" ||
    issue.resourceType === "provider_mapping" ||
    issue.code.startsWith("commerce.mapping.") ||
    issue.code.startsWith("commerce.observation.") ||
    issue.code === "mappingAmbiguous" ||
    issue.code === "mappingMissing" ||
    issue.code === "metadataStale" ||
    issue.code === "productNotFound" ||
    issue.code === "productUnavailable" ||
    issue.code === "syncFailed" ||
    issue.code === "syncPartial" ||
    issue.code === "syncInProgress" ||
    issue.code.startsWith("product.mapping") ||
    issue.code.startsWith("product.metadata") ||
    issue.code.startsWith("product.entitlement") ||
    issue.code.startsWith("product.unavailable") ||
    issue.code === "product.not_ready"
  ) {
    return productHref(context, issue)
  }

  if (issue.code.startsWith("product.")) {
    return appendSearch(context.catalogHref, { returnTo: context.returnTo })
  }
  return undefined
}

export function publishRecoveryLabel(issue: PublishValidationIssue) {
  if (issue.recoveryLabel) return issue.recoveryLabel
  if (issue.recoveryAction) return providerRecoveryDescriptor(issue.recoveryAction).label
  if (
    issue.resourceType === "provider_assignment" ||
    issue.resourceType === "provider_connection" ||
    issue.code.startsWith("provider.") ||
    issue.code.startsWith("commerce.provider.") ||
    issue.code.includes("active_provider") ||
    issue.code.includes("connection")
  ) {
    return "Review Purchase setup"
  }
  if (issue.code === "commerce.mapping.basePlanMissing") return "Select base plan"
  if (
    issue.code === "commerce.mapping.offerMissing" ||
    issue.code === "commerce.mapping.offerIneligible"
  ) {
    return "Review Google Play offer"
  }
  if (issue.code.startsWith("commerce.observation.")) return "Review test evidence"
  if (
    issue.code.startsWith("product.mapping") ||
    issue.code.startsWith("commerce.mapping.") ||
    issue.code === "mappingAmbiguous" ||
    issue.code === "mappingMissing"
  ) {
    return "Review Product mapping"
  }
  if (issue.code.startsWith("product.metadata") || issue.code === "metadataStale") {
    return "Retry Product synchronization"
  }
  if (issue.code.startsWith("product.entitlement")) return "Add Entitlement grant"
  if (issue.code.startsWith("placement.")) return "Review Placements"
  if (issue.code.startsWith("asset.")) return "Review Assets"
  return "Resolve issue"
}
