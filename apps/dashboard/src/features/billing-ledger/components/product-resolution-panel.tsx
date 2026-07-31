import { DefinitionRow, StatusPill } from "@/features/billing-ledger/components/billing-chrome"
import {
  resolutionStateExplanation,
  resolutionStateLabel,
} from "@/features/billing-ledger/types/billing-vocabulary"
import { WorkflowPanel } from "@/features/orgs/components/workspace-page"
import type { Product, TransactionFact } from "@/generated/api"

/**
 * The Resolution Snapshot.
 *
 * Resolution is read-only here. The exact mapping version used is recorded so a
 * historical resolution stays reproducible; nothing on this panel can re-point
 * a fact at a different Mosaic Product, because that would silently rewrite
 * what a past transaction meant.
 */
export function ProductResolutionPanel({
  fact,
  productHref,
  products,
  quarantineHref,
}: {
  fact: TransactionFact
  productHref: (productId: string) => string
  products: readonly Product[]
  quarantineHref: string
}) {
  const product = products.find((item) => item.id === fact.mosaicProductId)
  const unresolved = fact.resolutionState === "unresolved" || !fact.mosaicProductId

  return (
    <WorkflowPanel
      description="Resolution matches the active mapping, then the mapping that was live when the transaction occurred, then the recorded replacement chain. Nothing resolves by display name, price, or approximate match."
      title="Product resolution"
    >
      <div className="flex flex-wrap items-center gap-2">
        <StatusPill
          label={resolutionStateLabel(fact.resolutionState)}
          tone={
            unresolved
              ? "attention"
              : fact.resolutionState === "active_mapping"
                ? "positive"
                : "neutral"
          }
        />
      </div>
      <p className="text-muted-foreground mt-3 text-sm leading-6">
        {resolutionStateExplanation(fact.resolutionState)}
      </p>

      <dl className="mt-4">
        <DefinitionRow
          label="Store Product identifier"
          value={fact.providerProductIdentifier ?? "—"}
        />
        {fact.providerBasePlanIdentifier ? (
          <DefinitionRow label="Base plan" value={fact.providerBasePlanIdentifier} />
        ) : null}
        {fact.providerOfferIdentifier ? (
          <DefinitionRow label="Offer" value={fact.providerOfferIdentifier} />
        ) : null}
        <DefinitionRow
          label="Mosaic Product"
          value={
            fact.mosaicProductId ? (
              <a className="text-primary font-medium" href={productHref(fact.mosaicProductId)}>
                {product?.internalName ?? fact.mosaicProductId}
              </a>
            ) : (
              "Unresolved"
            )
          }
        />
        <DefinitionRow label="Mapping" value={fact.providerProductMappingId ?? "—"} />
        <DefinitionRow
          label="Mapping version used"
          value={
            fact.resolvedMappingVersion === undefined ? "—" : String(fact.resolvedMappingVersion)
          }
        />
        <DefinitionRow
          label="Validator version"
          value={fact.validatorVersion === undefined ? "—" : String(fact.validatorVersion)}
        />
      </dl>

      {unresolved ? (
        <div className="border-border bg-muted/30 mt-4 rounded border p-4 text-sm leading-6">
          <p className="font-medium">The store confirmed a Product Mosaic does not recognise.</p>
          <p className="text-muted-foreground mt-1">
            The input is kept as evidence rather than dropped. Repair the mapping on the Mosaic
            Product, then re-run validation from the quarantine record — resolution is never
            corrected by hand from this panel.
          </p>
          <a className="text-primary mt-2 inline-flex text-sm font-semibold" href={quarantineHref}>
            Open quarantine
          </a>
        </div>
      ) : null}
    </WorkflowPanel>
  )
}
