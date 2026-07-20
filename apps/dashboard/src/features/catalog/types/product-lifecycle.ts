interface ProductUsageSummary {
  entitlements: readonly unknown[]
  historicalReferences: readonly unknown[]
  plans: readonly unknown[]
  providerMappings: readonly unknown[]
}

interface ReplacementCandidate {
  id: string
  status: string
  type?: string
}

export function countProductUsage(usage?: ProductUsageSummary) {
  if (!usage) return 0

  return (
    usage.plans.length +
    usage.entitlements.length +
    usage.providerMappings.length +
    usage.historicalReferences.length
  )
}

export function canConfirmProductArchive(usageCount: number, replacementSelected: boolean) {
  return usageCount === 0 || replacementSelected
}

export function replacementCandidates<T extends ReplacementCandidate>(
  products: readonly T[],
  currentProductId: string,
  currentProductType?: string,
) {
  return products.filter(
    (product) =>
      product.id !== currentProductId &&
      product.status !== "archived" &&
      (currentProductType === undefined || product.type === currentProductType),
  )
}
