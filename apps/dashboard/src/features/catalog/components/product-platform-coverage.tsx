import { Button } from "@/components/ui/button"
import { nativeProviderLabel } from "@/features/catalog/types/native-provider-mapping"
import { readinessStateLabel } from "@/features/catalog/types/connected-product-view"
import type {
  Application,
  Environment,
  ProviderConnection,
  ProviderProductMapping,
  ProviderReadiness,
} from "@/generated/api"

export interface ProductPlatformCoverageRow {
  application: Application
  mapping?: ProviderProductMapping
  readiness?: ProviderReadiness
}

export function ProductPlatformCoverage({
  connections,
  environment,
  isLoading,
  onInspect,
  rows,
  selectedApplicationId,
}: {
  connections: readonly ProviderConnection[]
  environment?: Environment
  isLoading: boolean
  onInspect: (applicationId: string) => void
  rows: readonly ProductPlatformCoverageRow[]
  selectedApplicationId?: string
}) {
  return (
    <section aria-labelledby="platform-coverage-title" className="rounded border">
      <header className="border-b px-5 py-4">
        <h2 className="text-sm font-semibold" id="platform-coverage-title">
          Platform coverage
        </h2>
        <p className="text-muted-foreground mt-1 text-sm leading-6">
          One explicit Mosaic Environment across every registered Application. Base plans and offers
          remain mapping details.
        </p>
      </header>
      <div className="p-5">
        {!environment ? (
          <div className="rounded border border-dashed p-4">
            <p className="text-sm font-semibold">Select an Environment</p>
            <p className="text-muted-foreground mt-1 text-sm">
              Mosaic does not infer Staging, Production, or another Environment for Product
              coverage.
            </p>
          </div>
        ) : rows.length === 0 ? (
          <div className="rounded border border-dashed p-4">
            <p className="text-sm font-semibold">Register an Application first</p>
            <p className="text-muted-foreground mt-1 text-sm">
              Add an iOS or Android Application before configuring its store mapping.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-2xl border-separate border-spacing-0 text-left text-sm">
              <caption className="sr-only">
                Product platform coverage for {environment.name}
              </caption>
              <thead>
                <tr className="text-muted-foreground">
                  <th className="border-b px-3 py-2 font-medium" scope="col">
                    Application
                  </th>
                  <th className="border-b px-3 py-2 font-medium" scope="col">
                    Platform
                  </th>
                  <th className="border-b px-3 py-2 font-medium" scope="col">
                    Active provider
                  </th>
                  <th className="border-b px-3 py-2 font-medium" scope="col">
                    Mapping
                  </th>
                  <th className="border-b px-3 py-2 font-medium" scope="col">
                    Readiness
                  </th>
                  <th className="border-b px-3 py-2 text-right font-medium" scope="col">
                    Action
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map(({ application, mapping, readiness }) => {
                  const connection = connections.find(
                    (candidate) => candidate.id === readiness?.connectionId,
                  )
                  const activeProvider = readiness?.provider ?? mapping?.provider
                  const provider = activeProvider
                    ? activeProvider === "app_store" || activeProvider === "google_play"
                      ? nativeProviderLabel(activeProvider)
                      : (connection?.name ??
                        (activeProvider === "revenuecat" ? "RevenueCat" : "Custom provider"))
                    : connection?.name
                  const selected = selectedApplicationId === application.id
                  return (
                    <tr key={application.id}>
                      <th className="border-b px-3 py-3 font-medium" scope="row">
                        <span className="block">{application.name}</span>
                        <span className="text-muted-foreground mt-0.5 block font-mono text-xs">
                          {application.identifier}
                        </span>
                      </th>
                      <td className="border-b px-3 py-3 uppercase">{application.platform}</td>
                      <td className="border-b px-3 py-3">{provider ?? "Not selected"}</td>
                      <td className="border-b px-3 py-3">
                        {mapping ? (
                          <span className="font-mono text-xs">
                            {mapping.providerProductIdentifier}
                          </span>
                        ) : (
                          "Missing"
                        )}
                      </td>
                      <td className="border-b px-3 py-3">
                        {readiness
                          ? readinessStateLabel(readiness.state)
                          : isLoading
                            ? "Checking…"
                            : "Unavailable"}
                      </td>
                      <td className="border-b px-3 py-3 text-right">
                        <Button
                          aria-pressed={selected}
                          onClick={() => onInspect(application.id)}
                          size="sm"
                          type="button"
                          variant={selected ? "secondary" : "outline"}
                        >
                          {selected ? "Selected" : mapping ? "Inspect" : "Add mapping"}
                        </Button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  )
}
