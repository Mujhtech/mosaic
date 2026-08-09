import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { EDITOR_TEMPLATES } from "@/features/paywall-editor/constants/templates";
import { PaywallCardPreview } from "@/features/paywalls/components/paywall-card-preview";
import type { HostedPublishingAdapter } from "@/features/publishing/api/hosted-publishing-adapter";
import { HostedPublishingAdapterProvider } from "@/features/publishing/api/hosted-publishing-adapter-provider";
import { createTestHostedPublishingAdapter } from "@/test/hosted-publishing-adapter";
import { required } from "@/test/required";

const TEMPLATE = required(EDITOR_TEMPLATES[0], "EDITOR_TEMPLATES[0]").document;

const observed: { intersect: () => void }[] = [];
const realIntersectionObserver = globalThis.IntersectionObserver;

/**
 * jsdom has no IntersectionObserver, and a stub that reports everything visible
 * would make the deferral under test untestable. This one reports nothing until
 * a test says so.
 */
class TestIntersectionObserver {
  private readonly callback: IntersectionObserverCallback;

  constructor(callback: IntersectionObserverCallback) {
    this.callback = callback;
  }

  observe(element: Element) {
    observed.push({
      intersect: () =>
        this.callback(
          [
            {
              isIntersecting: true,
              target: element,
            } as IntersectionObserverEntry,
          ],
          this as unknown as IntersectionObserver
        ),
    });
  }

  disconnect() {
    // Nothing to release: entries are held by the test, not the observer.
  }

  unobserve() {
    // Nothing to release.
  }
}

function renderPreview(adapter: HostedPublishingAdapter) {
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={new QueryClient()}>
        <HostedPublishingAdapterProvider adapter={adapter}>
          {children}
        </HostedPublishingAdapterProvider>
      </QueryClientProvider>
    );
  }

  return render(
    <Wrapper>
      <PaywallCardPreview
        environmentId="env_staging"
        paywallId="paywall_01"
        projectId="project_01"
      />
    </Wrapper>
  );
}

function scrollIntoView() {
  act(() => {
    for (const entry of observed) {
      entry.intersect();
    }
  });
}

beforeEach(() => {
  observed.length = 0;
  globalThis.IntersectionObserver =
    TestIntersectionObserver as unknown as typeof IntersectionObserver;
});

afterEach(() => {
  globalThis.IntersectionObserver = realIntersectionObserver;
});

describe("PaywallCardPreview", () => {
  it("reads no document until the card is scrolled into view", async () => {
    // The risk is a Project with many Paywalls opening by downloading every
    // document at once. Deferral is the only thing preventing that, so it is
    // asserted directly rather than inferred from the rendered output.
    const getPaywallPreviewDocument = vi
      .fn()
      .mockResolvedValue({ document: TEMPLATE, source: "publishedVersion" });
    renderPreview(
      createTestHostedPublishingAdapter({ getPaywallPreviewDocument })
    );

    expect(getPaywallPreviewDocument).not.toHaveBeenCalled();

    scrollIntoView();

    await waitFor(() =>
      expect(
        screen.getByTestId("paywall-preview-thumbnail")
      ).toBeInTheDocument()
    );
    expect(getPaywallPreviewDocument).toHaveBeenCalledExactlyOnceWith({
      environmentId: "env_staging",
      paywallId: "paywall_01",
      projectId: "project_01",
    });
  });

  it("shows the placeholder when the Paywall has nothing published or drafted here", async () => {
    renderPreview(
      createTestHostedPublishingAdapter({
        getPaywallPreviewDocument: vi.fn().mockResolvedValue(null),
      })
    );
    scrollIntoView();

    expect(
      await screen.findByTestId("paywall-preview-placeholder")
    ).toBeInTheDocument();
  });

  it("shows the placeholder when the document cannot be read, instead of failing the card", async () => {
    // The adapter rejects the way it does for a document that fails to parse.
    // A thumbnail is decorative, so the card must survive it.
    renderPreview(
      createTestHostedPublishingAdapter({
        getPaywallPreviewDocument: vi
          .fn()
          .mockRejectedValue(
            new Error("The hosted Draft returned an invalid Mosaic document.")
          ),
      })
    );
    scrollIntoView();

    expect(
      await screen.findByTestId("paywall-preview-placeholder")
    ).toBeInTheDocument();
  });
});
