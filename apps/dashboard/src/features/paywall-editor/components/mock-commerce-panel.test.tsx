import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useEffect, useState } from "react";
import { describe, expect, it } from "vitest";
import { catalogKeys } from "@/features/catalog/queries/catalog-query";
import { MockCommercePanel } from "@/features/paywall-editor/components/mock-commerce-panel";
import { EDITOR_TEMPLATES } from "@/features/paywall-editor/constants/templates";
import {
  EditorStoreProvider,
  useEditorActions,
  useEditorStore,
} from "@/features/paywall-editor/stores/editor-store-context";
import { StudioSourceProvider } from "@/features/paywall-editor/stores/studio-source-context";
import type {
  MockProductDefinition,
  MockPurchaseState,
} from "@/features/paywall-editor/types/editor";
import { cloneValue } from "@/features/paywall-editor/utils/clone";
import { findNode } from "@/features/paywall-editor/utils/document-tree";
import { studioApplicationsErrorMessage } from "@/features/paywall-editor/utils/studio-applications-error";
import { projectKeys } from "@/features/projects/queries/projects-query";
import type { ProductList } from "@/generated/api";
import { ApiError } from "@/lib/api/errors";
import { chooseSelectOption } from "@/test/select";

function Harness() {
  const { document } = useEditorStore();
  const { replaceDocument } = useEditorActions();
  const [products, setProducts] = useState<MockProductDefinition[]>([
    {
      productReferenceId: "starter-plan",
      availability: "unavailable",
      reason: "notConfigured",
    },
  ]);
  const [purchaseState, setPurchaseState] =
    useState<MockPurchaseState>("productUnavailable");

  useEffect(() => {
    if (document) {
      return;
    }
    const imported = cloneValue(EDITOR_TEMPLATES[0]!.document);
    imported.products = [
      {
        ...imported.products[0]!,
        id: "starter-plan",
        label: {
          default: "Starter",
          localizationKey: "paywall.products.monthly",
        },
      },
    ];
    imported.localization.locales.en!.strings["paywall.products.monthly"] =
      "Starter";
    const selector = findNode(imported, "plans");
    if (selector?.type === "productSelector") {
      selector.cards = [
        { ...selector.cards[0]!, productReferenceId: "starter-plan" },
      ];
      selector.initialProductCardId = selector.cards[0]!.id;
    }
    replaceDocument(imported);
  }, [document, replaceDocument]);

  return (
    <>
      <MockCommercePanel
        mockProducts={products}
        mockPurchaseState={purchaseState}
        onProductsChange={setProducts}
        onPurchaseStateChange={setPurchaseState}
      />
      <output aria-label="mock state">
        {JSON.stringify({ products, purchaseState })}
      </output>
    </>
  );
}

function HostedHarness() {
  const { document } = useEditorStore();
  const { replaceDocument } = useEditorActions();
  const [products, setProducts] = useState<MockProductDefinition[]>([
    {
      productReferenceId: "starter-plan",
      availability: "available",
      billingPeriod: { unit: "month", value: 1 },
      currencyCode: "USD",
      kind: "subscription",
      localizedPrice: "$4.99",
    },
  ]);
  const [purchaseState, setPurchaseState] =
    useState<MockPurchaseState>("productAvailable");

  useEffect(() => {
    if (document) {
      return;
    }
    const imported = cloneValue(EDITOR_TEMPLATES[0]!.document);
    imported.products = [
      {
        ...imported.products[0]!,
        id: "starter-plan",
        label: {
          default: "Starter",
          localizationKey: "paywall.products.monthly",
        },
        productId: "legacy-provider-id",
      },
    ];
    imported.localization.locales.en!.strings["paywall.products.monthly"] =
      "Starter";
    const selector = findNode(imported, "plans");
    if (selector?.type === "productSelector") {
      selector.cards = [
        { ...selector.cards[0]!, productReferenceId: "starter-plan" },
      ];
      selector.initialProductCardId = selector.cards[0]!.id;
    }
    replaceDocument(imported);
  }, [document, replaceDocument]);

  return (
    <>
      <MockCommercePanel
        mockProducts={products}
        mockPurchaseState={purchaseState}
        onProductsChange={setProducts}
        onPurchaseStateChange={setPurchaseState}
      />
      <output aria-label="hosted document product">
        {document?.products[0]?.productId}
      </output>
      <output aria-label="hosted document">{JSON.stringify(document)}</output>
      <output aria-label="hosted mock state">
        {JSON.stringify({ products, purchaseState })}
      </output>
    </>
  );
}

describe("mock commerce controls", () => {
  it("keeps Studio editable while naming Application permission failures", () => {
    expect(
      studioApplicationsErrorMessage(
        new ApiError("forbidden", {
          code: "forbidden",
          correlationId: "correlation_01",
          retryable: false,
          status: 403,
        })
      )
    ).toBe(
      "You can edit this Draft, but you do not have permission to inspect its Applications."
    );
  });

  it("shows a named Studio scope and direct Application recovery when none are registered", async () => {
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false, staleTime: Number.POSITIVE_INFINITY },
      },
    });
    queryClient.setQueryData(catalogKeys.products("project_01"), {
      items: [
        {
          createdAt: "2026-07-22T12:00:00Z",
          id: "product_mosaic_monthly",
          internalName: "Monthly",
          key: "monthly",
          metadataSource: "provider",
          projectId: "project_01",
          readiness: { metadataSource: "provider", ready: true, reasons: [] },
          status: "connected",
          type: "subscription",
          updatedAt: "2026-07-22T12:00:00Z",
        },
      ],
      page: {},
    } satisfies ProductList["data"]);
    queryClient.setQueryData(projectKeys.applications("project_01"), {
      items: [],
      page: {},
    });

    render(
      <QueryClientProvider client={queryClient}>
        <StudioSourceProvider
          source={{
            draftId: "draft_01",
            environmentId: "env_01",
            environmentName: "Staging",
            kind: "hosted",
            organizationId: "org_01",
            paywallId: "paywall_01",
            projectId: "project_01",
          }}
        >
          <EditorStoreProvider>
            <HostedHarness />
          </EditorStoreProvider>
        </StudioSourceProvider>
      </QueryClientProvider>
    );

    expect(await screen.findByText("No registered Applications")).toBeVisible();
    expect(screen.getByText(/Hosted Environment: Staging/)).toBeVisible();
    expect(
      screen.getByRole("link", { name: "Register Application" })
    ).toHaveAttribute("href", "/orgs/org_01/projects/project_01/apps");
    expect(
      screen.getByLabelText("Provider preview Application")
    ).toBeDisabled();
  });

  it("binds an imported product and commits its local price on blur", async () => {
    render(
      <EditorStoreProvider>
        <Harness />
      </EditorStoreProvider>
    );

    await chooseSelectOption(
      screen.getByLabelText("Starter mock availability"),
      "Available"
    );
    const price = screen.getByLabelText("Starter local price");
    fireEvent.change(price, { target: { value: "$4.99" } });
    fireEvent.blur(price);

    expect(screen.getByLabelText("mock state")).toHaveTextContent(
      '"productReferenceId":"starter-plan","availability":"available"'
    );
    expect(screen.getByLabelText("mock state")).toHaveTextContent(
      '"localizedPrice":"$4.99"'
    );
    expect(screen.getByLabelText("mock state")).toHaveTextContent(
      '"purchaseState":"productAvailable"'
    );
  });

  it("exposes deterministic empty and failed restore outcomes", async () => {
    render(
      <EditorStoreProvider>
        <Harness />
      </EditorStoreProvider>
    );

    const outcome = screen.getByLabelText("Preview state");
    expect(outcome).toHaveTextContent("Product unavailable");
    await chooseSelectOption(outcome, "Restore has no purchases");
    expect(screen.getByLabelText("mock state")).toHaveTextContent(
      '"purchaseState":"restoreNoPurchases"'
    );
    await chooseSelectOption(outcome, "Restore failure");
    expect(screen.getByLabelText("mock state")).toHaveTextContent(
      '"purchaseState":"restoreFailure"'
    );
  });

  it("binds reachable Product identity without changing simulated preview metadata", async () => {
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false, staleTime: Number.POSITIVE_INFINITY },
      },
    });
    const connectedProducts = {
      items: [
        {
          createdAt: "2026-07-22T12:00:00Z",
          id: "product_mosaic_monthly",
          internalName: "Monthly",
          key: "monthly",
          metadataSource: "provider",
          projectId: "project_01",
          readiness: { metadataSource: "provider", ready: true, reasons: [] },
          status: "connected",
          type: "subscription",
          updatedAt: "2026-07-22T12:00:00Z",
        },
      ],
      page: {},
    } satisfies ProductList["data"];
    queryClient.setQueryData(
      catalogKeys.products("project_01"),
      connectedProducts
    );

    render(
      <QueryClientProvider client={queryClient}>
        <StudioSourceProvider
          source={{
            draftId: "draft_01",
            environmentId: "env_01",
            kind: "hosted",
            organizationId: "org_01",
            paywallId: "paywall_01",
            projectId: "project_01",
          }}
        >
          <EditorStoreProvider>
            <HostedHarness />
          </EditorStoreProvider>
        </StudioSourceProvider>
      </QueryClientProvider>
    );

    const binding = await screen.findByLabelText("Catalog Product for Starter");
    await chooseSelectOption(binding, "Monthly · connected");

    await waitFor(() =>
      expect(
        screen.getByLabelText("hosted document product")
      ).toHaveTextContent("product_mosaic_monthly")
    );
    expect(screen.getByLabelText("Starter mock availability")).toBeVisible();
    expect(
      screen.getByLabelText("Provider preview Application")
    ).toHaveTextContent("Select Application");
    expect(
      screen.getByText(
        /Select an Application to inspect its active provider, mapping, and readiness/
      )
    ).toBeVisible();
    expect(screen.getByLabelText("hosted mock state")).toHaveTextContent(
      '"localizedPrice":"$4.99"'
    );
    expect(screen.getByLabelText("hosted document")).not.toHaveTextContent(
      "$4.99"
    );
  });
});
