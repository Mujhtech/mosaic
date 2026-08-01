import { Button } from "@/components/ui/button";
import { readinessStateLabel } from "@/features/catalog/types/connected-product-view";
import { nativeProviderLabel } from "@/features/catalog/types/native-provider-mapping";
import type {
  Application,
  Environment,
  ProviderConnection,
  ProviderProductMapping,
  ProviderReadiness,
} from "@/generated/api";

export interface ProductPlatformCoverageRow {
  application: Application;
  mapping?: ProviderProductMapping;
  readiness?: ProviderReadiness;
}

export function ProductPlatformCoverage({
  connections,
  environment,
  isLoading,
  onInspect,
  rows,
  selectedApplicationId,
}: {
  connections: readonly ProviderConnection[];
  environment?: Environment;
  isLoading: boolean;
  onInspect: (applicationId: string) => void;
  rows: readonly ProductPlatformCoverageRow[];
  selectedApplicationId?: string;
}) {
  return (
    <section
      aria-labelledby="platform-coverage-title"
      className="rounded border"
    >
      <header className="border-b px-5 py-4">
        <h2 className="font-semibold text-sm" id="platform-coverage-title">
          Platform coverage
        </h2>
        <p className="mt-1 text-muted-foreground text-sm leading-6">
          One explicit Mosaic Environment across every registered Application.
          Base plans and offers remain mapping details.
        </p>
      </header>
      <div className="p-5">
        {(() => {
          if (environment) {
            return (() => {
              if (rows.length === 0) {
                return (
                  <div className="rounded border border-dashed p-4">
                    <p className="font-semibold text-sm">
                      Register an Application first
                    </p>
                    <p className="mt-1 text-muted-foreground text-sm">
                      Add an iOS or Android Application before configuring its
                      store mapping.
                    </p>
                  </div>
                );
              }
              return (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-2xl border-separate border-spacing-0 text-left text-sm">
                    <caption className="sr-only">
                      Product platform coverage for {environment.name}
                    </caption>
                    <thead>
                      <tr className="text-muted-foreground">
                        <th
                          className="border-b px-3 py-2 font-medium"
                          scope="col"
                        >
                          Application
                        </th>
                        <th
                          className="border-b px-3 py-2 font-medium"
                          scope="col"
                        >
                          Platform
                        </th>
                        <th
                          className="border-b px-3 py-2 font-medium"
                          scope="col"
                        >
                          Active provider
                        </th>
                        <th
                          className="border-b px-3 py-2 font-medium"
                          scope="col"
                        >
                          Mapping
                        </th>
                        <th
                          className="border-b px-3 py-2 font-medium"
                          scope="col"
                        >
                          Readiness
                        </th>
                        <th
                          className="border-b px-3 py-2 text-right font-medium"
                          scope="col"
                        >
                          Action
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map(({ application, mapping, readiness }) => {
                        const connection = connections.find(
                          (candidate) =>
                            candidate.id === readiness?.connectionId
                        );
                        const activeProvider =
                          readiness?.provider ?? mapping?.provider;
                        const provider = (() => {
                          if (activeProvider) {
                            return (() => {
                              if (
                                activeProvider === "app_store" ||
                                activeProvider === "google_play"
                              ) {
                                return nativeProviderLabel(activeProvider);
                              }
                              return (
                                connection?.name ??
                                (activeProvider === "revenuecat"
                                  ? "RevenueCat"
                                  : "Custom provider")
                              );
                            })();
                          }
                          return connection?.name;
                        })();
                        const selected =
                          selectedApplicationId === application.id;
                        return (
                          <tr key={application.id}>
                            <th
                              className="border-b px-3 py-3 font-medium"
                              scope="row"
                            >
                              <span className="block">{application.name}</span>
                              <span className="mt-0.5 block font-mono text-muted-foreground text-xs">
                                {application.identifier}
                              </span>
                            </th>
                            <td className="border-b px-3 py-3 uppercase">
                              {application.platform}
                            </td>
                            <td className="border-b px-3 py-3">
                              {provider ?? "Not selected"}
                            </td>
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
                              {(() => {
                                if (readiness) {
                                  return readinessStateLabel(readiness.state);
                                }
                                if (isLoading) {
                                  return "Checking…";
                                }
                                return "Unavailable";
                              })()}
                            </td>
                            <td className="border-b px-3 py-3 text-right">
                              <Button
                                aria-pressed={selected}
                                onClick={() => onInspect(application.id)}
                                size="sm"
                                type="button"
                                variant={selected ? "secondary" : "outline"}
                              >
                                {(() => {
                                  if (selected) {
                                    return "Selected";
                                  }
                                  if (mapping) {
                                    return "Inspect";
                                  }
                                  return "Add mapping";
                                })()}
                              </Button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              );
            })();
          }
          return (
            <div className="rounded border border-dashed p-4">
              <p className="font-semibold text-sm">Select an Environment</p>
              <p className="mt-1 text-muted-foreground text-sm">
                Mosaic does not infer Staging, Production, or another
                Environment for Product coverage.
              </p>
            </div>
          );
        })()}
      </div>
    </section>
  );
}
