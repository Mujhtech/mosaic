import { createFileRoute } from "@tanstack/react-router";
import { safeInternalReturnTo } from "@/features/auth/types/hosted-access";
import { ProductDetailPage } from "@/features/catalog/components/product-detail-page";
import { routeHead } from "@/lib/routing/route-head";

interface ProductReadinessSearch {
  applicationId?: string;
  environmentId?: string;
  returnTo?: string;
}

export const Route = createFileRoute(
  "/_hosted/orgs/$organizationId/projects/$projectId/env/$environmentKey/catalog/products/$productId"
)({
  validateSearch: (search: Record<string, unknown>): ProductReadinessSearch => {
    const returnTo = safeInternalReturnTo(search.returnTo, "");
    return {
      applicationId:
        typeof search.applicationId === "string" &&
        search.applicationId.length > 0
          ? search.applicationId
          : undefined,
      environmentId:
        typeof search.environmentId === "string" &&
        search.environmentId.length > 0
          ? search.environmentId
          : undefined,
      ...(returnTo ? { returnTo } : {}),
    };
  },
  component: CatalogProductRoute,
  head: () => routeHead({ title: "Product" }),
});

function CatalogProductRoute() {
  const { organizationId, productId, projectId } = Route.useParams();
  const { applicationId, environmentId, returnTo } = Route.useSearch();
  const navigate = Route.useNavigate();

  return (
    <ProductDetailPage
      onReadinessScopeChange={(scope) => {
        navigate({ replace: true, search: { ...scope, returnTo } });
      }}
      organizationId={organizationId}
      productId={productId}
      projectId={projectId}
      readinessApplicationId={applicationId}
      readinessEnvironmentId={environmentId}
      returnTo={returnTo}
    />
  );
}
