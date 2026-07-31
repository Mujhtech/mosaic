import type { PublishValidationIssue } from "@/features/publishing/api/hosted-publishing-adapter"

interface PublishRecoveryContext {
  assetsHref: string
  catalogHref: string
  environmentId: string
  organizationId: string
  placementsHref: string
  projectId: string
  providersHref: string
}

function productHref(context: PublishRecoveryContext, issue: PublishValidationIssue) {
  if (!issue.productId) return context.catalogHref

  const base = `/organizations/${encodeURIComponent(context.organizationId)}/projects/${encodeURIComponent(context.projectId)}/catalog/products/${encodeURIComponent(issue.productId)}`
  const search = new URLSearchParams()
  search.set("environmentId", issue.environmentId ?? context.environmentId)
  if (issue.applicationId) search.set("applicationId", issue.applicationId)
  return `${base}?${search.toString()}`
}

export function publishRecoveryHref(
  issue: PublishValidationIssue,
  context: PublishRecoveryContext,
) {
  if (issue.recoveryHref) return issue.recoveryHref
  if (issue.code.startsWith("asset.")) return context.assetsHref
  if (issue.code.startsWith("placement.")) return context.placementsHref

  if (
    issue.resourceType === "provider_assignment" ||
    issue.resourceType === "provider_connection" ||
    issue.code.startsWith("provider.") ||
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
    const separator = context.providersHref.includes("?") ? "&" : "?"
    return `${context.providersHref}${separator}environmentId=${encodeURIComponent(issue.environmentId ?? context.environmentId)}`
  }

  if (
    issue.resourceType === "product" ||
    issue.resourceType === "provider_mapping" ||
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

  if (issue.code.startsWith("product.")) return context.catalogHref
  return undefined
}

export function publishRecoveryLabel(issue: PublishValidationIssue) {
  if (issue.recoveryLabel) return issue.recoveryLabel
  if (
    issue.resourceType === "provider_assignment" ||
    issue.resourceType === "provider_connection" ||
    issue.code.startsWith("provider.") ||
    issue.code.includes("active_provider") ||
    issue.code.includes("connection")
  ) {
    return "Review Commerce providers"
  }
  if (
    issue.code.startsWith("product.mapping") ||
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
