import { describe, expect, it } from "vitest";

import { providerDocumentReferencesProducts } from "@/features/provider-connections/queries/provider-connection-queries";

describe("provider assignment Paywall impact", () => {
  it("finds stable Mosaic Product IDs without treating provider identifiers as bindings", () => {
    const document = {
      children: [
        {
          props: {
            productId: "product_monthly",
            providerProductIdentifier: "rc_resource_123",
          },
        },
      ],
    };

    expect(
      providerDocumentReferencesProducts(document, new Set(["product_monthly"]))
    ).toBe(true);
    expect(
      providerDocumentReferencesProducts(document, new Set(["rc_resource_123"]))
    ).toBe(false);
    expect(
      providerDocumentReferencesProducts(document, new Set(["product_yearly"]))
    ).toBe(false);
  });
});
