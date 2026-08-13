import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { FigmaImportDialog } from "@/features/paywall-editor/components/figma-import-dialog";
import {
  FIGMA_BUNDLE_FORMAT,
  type FigmaBundleImage,
  type FigmaExportBundle,
} from "@/features/paywall-editor/mutations/figma-import";
import type { MosaicDocument } from "@/features/paywall-editor/types/editor";
import {
  LOCAL_STUDIO_SOURCE,
  type StudioSource,
} from "@/features/paywall-editor/types/studio-source";
import canonicalFixture from "../../../../../../protocol/fixtures/v0.4/complete-paywall.json";

const PIXEL_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

const hostedSource: StudioSource = {
  draftId: "draft_1",
  environmentId: "env_1",
  kind: "hosted",
  organizationId: "org_1",
  paywallId: "paywall_1",
  projectId: "project_1",
};

function image(overrides: Partial<FigmaBundleImage> = {}): FigmaBundleImage {
  return {
    accessibilityLabel: "Hero artwork",
    bytesBase64: PIXEL_PNG_BASE64,
    height: 600,
    id: "hero-shot",
    mimeType: "image/png",
    name: "Hero shot",
    placement: {
      childIndex: 1,
      parentStackId: "paywall-content",
      screenId: "offer",
    },
    scale: 2,
    width: 1200,
    ...overrides,
  };
}

function bundle(images: FigmaBundleImage[] = [image()]): FigmaExportBundle {
  return {
    document: canonicalFixture as MosaicDocument,
    format: FIGMA_BUNDLE_FORMAT,
    formatVersion: 1,
    images,
    report: {
      skipped: [
        {
          kind: "unsupportedNode",
          layerPath: "Page 1 / Offer / Blur",
          message: "Layer blur has no Mosaic equivalent.",
        },
      ],
      warnings: [
        {
          code: "typography.substituted",
          layerPath: "Page 1 / Offer / Headline",
          message: "Inter Tight was mapped to the body typography style.",
        },
      ],
    },
  };
}

function renderDialog(source: StudioSource, images?: FigmaBundleImage[]) {
  const onApply = vi.fn();
  render(
    <FigmaImportDialog
      bundle={bundle(images)}
      error={null}
      isPending={false}
      onApply={onApply}
      onOpenChange={vi.fn()}
      progress={null}
      replacesOpenPaywall
      source={source}
    />
  );
  return { onApply };
}

describe("FigmaImportDialog", () => {
  // The plugin's own account of what it could not translate is the only record
  // of the conversion loss; applying the import without showing it would hide
  // a silent downgrade inside the author's paywall.
  it("shows the plugin's warnings and skipped layers before anything is applied", () => {
    renderDialog(hostedSource);
    expect(
      screen.getByRole("heading", { name: /Converted with changes \(1\)/ })
    ).toBeVisible();
    expect(
      screen.getByText("Inter Tight was mapped to the body typography style.")
    ).toBeVisible();
    expect(
      screen.getByRole("heading", { name: /Not converted \(1\)/ })
    ).toBeVisible();
    expect(
      screen.getByText("Layer blur has no Mosaic equivalent.")
    ).toBeVisible();
  });

  // Local Studio cannot upload, so offering an image checkbox there would
  // promise an Asset that can never exist.
  it("presents images as not imported in local Studio", () => {
    const { onApply } = renderDialog(LOCAL_STUDIO_SOURCE);
    expect(
      screen.getByRole("heading", { name: /Images not imported \(1\)/ })
    ).toBeVisible();
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    // Stated both in the summary and beside the images themselves.
    expect(
      screen.getAllByText(/Open a hosted Draft to import images/).length
    ).toBeGreaterThan(0);

    fireEvent.click(
      screen.getByRole("button", { name: "Import paywall only" })
    );
    expect(onApply).toHaveBeenCalledWith([]);
  });

  it("includes hosted images by default and applies only the chosen ones", () => {
    const { onApply } = renderDialog(hostedSource, [
      image(),
      image({ id: "footer-badge", name: "Footer badge" }),
    ]);
    const checkboxes = screen.getAllByRole("checkbox");
    expect(checkboxes).toHaveLength(2);
    for (const checkbox of checkboxes) {
      expect(checkbox).toBeChecked();
    }

    fireEvent.click(screen.getByRole("checkbox", { name: "Footer badge" }));
    fireEvent.click(
      screen.getByRole("button", { name: "Import paywall and 1 image" })
    );
    expect(onApply).toHaveBeenCalledWith(["hero-shot"]);
  });

  // An image whose bytes cannot be read would upload as a corrupt Asset, so it
  // must not be selectable and must say why.
  it("excludes an image whose bytes cannot be decoded", () => {
    const { onApply } = renderDialog(hostedSource, [
      image(),
      image({
        bytesBase64: "not base64 !!",
        id: "broken-art",
        name: "Broken art",
      }),
    ]);
    expect(screen.getByRole("checkbox", { name: "Broken art" })).toBeDisabled();
    expect(
      screen.getByText(/This image cannot be read from the bundle/)
    ).toBeVisible();

    fireEvent.click(
      screen.getByRole("button", { name: "Import paywall and 1 image" })
    );
    expect(onApply).toHaveBeenCalledWith(["hero-shot"]);
  });
});
