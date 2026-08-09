import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { PaywallPreviewThumbnail } from "@/features/paywall-editor/components/paywall-preview-thumbnail";
import { EDITOR_TEMPLATES } from "@/features/paywall-editor/constants/templates";
import type { MosaicDocument } from "@/features/paywall-editor/types/editor";
import { required } from "@/test/required";

const TEMPLATE = required(EDITOR_TEMPLATES[0], "EDITOR_TEMPLATES[0]").document;

describe("PaywallPreviewThumbnail", () => {
  it("draws the initial screen in the document's own default locale", () => {
    // The template declares en, de and ar catalogs and defaults to en. A
    // thumbnail that picked the wrong catalog would still look like a Paywall,
    // which is exactly why the assertion names both the expected and the
    // rejected string.
    const { container } = render(
      <PaywallPreviewThumbnail document={TEMPLATE} width={116} />
    );

    expect(
      screen.getByText("Build a paywall people understand")
    ).toBeInTheDocument();
    expect(
      screen.queryByText("Baue eine Paywall, die verstanden wird")
    ).not.toBeInTheDocument();
    expect(container.querySelector('[dir="ltr"]')).not.toBeNull();
  });

  it("stays decorative and inert, so a card keeps exactly one accessible name", () => {
    // Every control inside a Paywall design is a real control. Left reachable,
    // a list of twenty cards would hand a keyboard user hundreds of tab stops
    // and a screen reader twenty duplicate readings of the same Paywall.
    render(<PaywallPreviewThumbnail document={TEMPLATE} width={116} />);

    const frame = screen.getByTestId("paywall-preview-thumbnail");
    expect(frame).toHaveAttribute("aria-hidden", "true");
    expect(frame).toHaveAttribute("inert");
  });

  it("throws for a document with no screen to draw, rather than rendering an empty frame", () => {
    // The caller's boundary turns this into the "no preview" placeholder. The
    // contract worth pinning is that a screenless document is refused instead
    // of quietly producing a blank phone that reads as a real design.
    const screenless = {
      ...TEMPLATE,
      screens: [],
    } as unknown as MosaicDocument;

    expect(() =>
      render(<PaywallPreviewThumbnail document={screenless} width={116} />)
    ).toThrow();
  });
});
