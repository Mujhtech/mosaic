import { ArrowSquareOutIcon } from "@phosphor-icons/react/dist/ssr/ArrowSquareOut"
import { CheckCircleIcon } from "@phosphor-icons/react/dist/ssr/CheckCircle"
import { WarningCircleIcon } from "@phosphor-icons/react/dist/ssr/WarningCircle"
import { useId } from "react"

import { Button } from "@/components/ui/button"
import {
  MOCK_PRODUCT_ACKNOWLEDGEMENT_CODE,
  type PublishValidationResult,
} from "@/features/publishing/api/hosted-publishing-adapter"

export function PublishReview({
  acknowledgeMockProducts,
  environmentLabel,
  isPublishing,
  isValidating = false,
  onAcknowledgeMockProductsChange,
  onPublish,
  revision,
  validation,
}: {
  acknowledgeMockProducts: boolean
  environmentLabel: string
  isPublishing: boolean
  isValidating?: boolean
  onAcknowledgeMockProductsChange: (acknowledged: boolean) => void
  onPublish: () => void
  revision: number
  validation: PublishValidationResult | null
}) {
  const acknowledgementId = useId()
  const blockingIssues = validation?.issues.filter((issue) => issue.severity === "error") ?? []
  const warnings = validation?.issues.filter((issue) => issue.severity === "warning") ?? []
  const requiresMockProductAcknowledgement = warnings.some(
    (issue) => issue.code === MOCK_PRODUCT_ACKNOWLEDGEMENT_CODE,
  )
  const blocked =
    !validation ||
    isValidating ||
    blockingIssues.length > 0 ||
    isPublishing ||
    (requiresMockProductAcknowledgement && !acknowledgeMockProducts)

  return (
    <section aria-labelledby="publish-review-title" className="border-border rounded border p-4">
      <h2 className="text-sm font-semibold" id="publish-review-title">
        Publish review
      </h2>
      <dl className="text-muted-foreground mt-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
        <dt>Environment</dt>
        <dd className="text-foreground font-medium">{environmentLabel}</dd>
        <dt>Draft revision</dt>
        <dd className="text-foreground font-medium">{revision}</dd>
        <dt>Protocol</dt>
        <dd className="text-foreground font-medium">
          {validation?.protocolVersion ?? "Checking…"}
        </dd>
      </dl>

      {validation ? (
        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          <ReadinessGroup
            items={validation.products.map((product) => ({
              label: product.name,
              ready: product.ready,
            }))}
            title="Products"
          />
          <ReadinessGroup
            items={validation.assets.map((asset) => ({ label: asset.name, ready: asset.ready }))}
            title="Assets"
          />
          <ReadinessGroup
            items={validation.placements.map((placement) => ({
              label: placement.key,
              ready: placement.bound,
            }))}
            title="Placements"
          />
        </div>
      ) : (
        <p aria-live="polite" className="text-muted-foreground mt-4 text-sm">
          Checking Products, Assets, Placements, and document compatibility…
        </p>
      )}

      {blockingIssues.length > 0 ? (
        <div
          className="border-destructive/25 bg-destructive/5 mt-4 rounded border p-3"
          role="alert"
        >
          <p className="flex items-center gap-2 text-sm font-semibold">
            <WarningCircleIcon aria-hidden className="text-destructive" />
            Publishing is blocked
          </p>
          <ul className="mt-2 space-y-2 text-sm">
            {blockingIssues.map((issue) => (
              <li key={`${issue.code}:${issue.message}`}>
                <p>{issue.message}</p>
                {issue.recoveryHref ? (
                  <a
                    className="text-primary mt-1 inline-flex items-center gap-1 font-medium"
                    href={issue.recoveryHref}
                  >
                    {issue.recoveryLabel ?? "Resolve issue"} <ArrowSquareOutIcon aria-hidden />
                  </a>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {warnings.length > 0 ? (
        <div className="border-border bg-muted/40 mt-4 rounded border p-3">
          <p className="text-sm font-semibold">Warnings to review</p>
          <ul className="text-muted-foreground mt-2 space-y-1 text-sm">
            {warnings.map((issue) => (
              <li key={`${issue.code}:${issue.message}`}>{issue.message}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {requiresMockProductAcknowledgement ? (
        <div className="border-border mt-4 flex items-start gap-3 rounded border p-3">
          <input
            checked={acknowledgeMockProducts}
            className="border-input accent-primary mt-1 size-4 shrink-0"
            id={acknowledgementId}
            onChange={(event) => onAcknowledgeMockProductsChange(event.currentTarget.checked)}
            type="checkbox"
          />
          <label className="text-sm leading-6" htmlFor={acknowledgementId}>
            I understand these products still use mock metadata and want to publish this immutable
            Release anyway.
          </label>
        </div>
      ) : null}

      {validation &&
      blockingIssues.length === 0 &&
      (!requiresMockProductAcknowledgement || acknowledgeMockProducts) ? (
        <p className="text-muted-foreground mt-4 flex items-center gap-2 text-sm">
          <CheckCircleIcon aria-hidden className="text-primary" weight="fill" />
          This Draft is ready to publish to {environmentLabel}.
        </p>
      ) : null}

      <Button className="mt-4" disabled={blocked} onClick={onPublish} type="button">
        {isPublishing ? "Publishing…" : `Publish to ${environmentLabel}`}
      </Button>
    </section>
  )
}

function ReadinessGroup({
  items,
  title,
}: {
  items: readonly { label: string; ready: boolean }[]
  title: string
}) {
  const readyCount = items.filter((item) => item.ready).length
  return (
    <section aria-label={`${title} readiness`} className="border-border rounded border p-3">
      <p className="text-xs font-semibold">{title}</p>
      <p className="text-muted-foreground mt-1 text-xs">
        {items.length === 0 ? "None referenced" : `${readyCount} of ${items.length} ready`}
      </p>
      {items.length > 0 ? (
        <ul className="mt-2 space-y-1 text-xs">
          {items.map((item) => (
            <li className="flex items-center gap-1.5" key={item.label}>
              {item.ready ? (
                <CheckCircleIcon aria-hidden className="text-primary" weight="fill" />
              ) : (
                <WarningCircleIcon aria-hidden className="text-destructive" />
              )}
              <span className="truncate" title={item.label}>
                {item.label}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  )
}
