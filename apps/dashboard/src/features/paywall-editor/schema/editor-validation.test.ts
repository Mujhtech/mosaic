import { describe, expect, it } from "vitest";
import { EDITOR_TEMPLATES } from "@/features/paywall-editor/constants/templates";
import { collectEditorValidation } from "@/features/paywall-editor/hooks/use-editor-validation";
import { validateEditorDocument } from "@/features/paywall-editor/schema/editor-validation";
import { createEditorStore } from "@/features/paywall-editor/stores/editor-store";
import { cloneValue } from "@/features/paywall-editor/utils/clone";
import { findNode } from "@/features/paywall-editor/utils/document-tree-traversal";
import { required } from "@/test/required";

describe("editor validation", () => {
  it("accepts every editor template with nothing to fix", () => {
    for (const template of EDITOR_TEMPLATES) {
      const { issues, contractValid } = collectEditorValidation(
        template.document
      );
      expect(contractValid).toBe(true);
      expect(issues.filter((issue) => issue.severity !== "info")).toEqual([]);
    }
  });

  it("reports the exact recursive JSON pointer for a nested component", () => {
    const template = EDITOR_TEMPLATES.find((entry) => entry.id === "focused");
    if (!template) {
      throw new Error("Missing focused template");
    }
    const document = cloneValue(template.document);
    const headline = required(
      document.screens[0],
      "document.screens[0]"
    ).layout.content.children.find((node) => node.id === "headline");
    if (!headline) {
      throw new Error("Missing headline");
    }

    headline.id = "Invalid headline";
    required(
      document.screens[0],
      "document.screens[0]"
    ).layout.content.children = required(
      document.screens[0],
      "document.screens[0]"
    ).layout.content.children.filter((node) => node !== headline);
    required(
      document.screens[0],
      "document.screens[0]"
    ).layout.content.children.unshift({
      type: "stack",
      id: "nested-stack",
      direction: "vertical",
      gap: 8,
      padding: { top: 0, start: 0, bottom: 0, end: 0 },
      mainAxisDistribution: "start",
      crossAxisAlignment: "stretch",
      children: [headline],
    });

    expect(
      validateEditorDocument(document).find(
        (issue) => issue.code === "component.invalidId"
      )
    ).toMatchObject({
      componentId: "Invalid headline",
      property: "id",
      documentPath: "/screens/0/layout/content/children/0/children/0/id",
    });
  });

  it("warns without blocking for indistinguishable states, contrast, truncation, and overflow", () => {
    const template = EDITOR_TEMPLATES.find((entry) => entry.id === "focused");
    if (!template) {
      throw new Error("Missing focused template");
    }
    const document = cloneValue(template.document);
    const card = findNode(document, "monthly-card");
    const name = findNode(document, "monthly-name");
    const purchase = findNode(document, "purchase");
    if (
      card?.type !== "productCard" ||
      name?.type !== "text" ||
      purchase?.type !== "button" ||
      purchase.children[0]?.type !== "text"
    ) {
      throw new Error("Missing warning fixtures");
    }

    required(document.screens[0], "document.screens[0]").layout.background = {
      type: "color",
      value: "#FFFFFFFF",
    };
    card.styles.default.background = { type: "color", value: "#FFFFFFFF" };
    card.styles.default.border = { color: "#FDFDFDFF", width: 1 };
    card.styles.default.opacity = 0.5;
    card.styles.selected = {};
    name.typography.color = "#FFFFFF80";
    name.typography.maxLines = 1;
    name.typography.overflow = "ellipsis";
    name.sizing = { width: { mode: "fixed", value: 120 }, height: "fit" };
    purchase.direction = "horizontal";
    purchase.sizing = { width: { mode: "fixed", value: 100 }, height: "fit" };

    const issues = validateEditorDocument(document);
    const warnings = issues.filter((issue) => issue.severity === "warning");
    expect(warnings.map((issue) => issue.code)).toEqual(
      expect.arrayContaining([
        "appearance.indistinguishableProductStates",
        "appearance.lowContrast",
        "appearance.lowBoundaryContrast",
        "typography.truncationRisk",
        "layout.horizontalOverflow",
      ])
    );
    expect(
      issues.filter((issue) => issue.code === "appearance.contrastCannotVerify")
    ).toEqual([]);
    expect(warnings).toContainEqual(
      expect.objectContaining({
        componentId: "monthly-card",
        property: "styles.selected",
      })
    );

    const merged = collectEditorValidation(document);
    expect(merged.contractValid).toBe(true);
    expect(merged.issues.some((issue) => issue.severity === "error")).toBe(
      false
    );
  });

  it("warns symmetrically when authored Fill is on an unbounded axis", () => {
    const document = cloneValue(
      required(EDITOR_TEMPLATES[0], "EDITOR_TEMPLATES[0]").document
    );
    const card = findNode(document, "monthly-card");
    const headline = findNode(document, "headline");
    if (card?.type !== "productCard" || !headline || headline.type !== "text") {
      throw new Error("Missing sizing fixtures");
    }

    card.sizing = { width: "fill", height: "fit" };
    headline.sizing = { width: "fill", height: "fill" };

    const fillWarnings = validateEditorDocument(document).filter(
      (issue) => issue.code === "layout.unboundedFill"
    );
    expect(fillWarnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          componentId: "monthly-card",
          property: "sizing.width",
        }),
        expect.objectContaining({
          componentId: "headline",
          property: "sizing.height",
        }),
      ])
    );
    expect(fillWarnings).not.toContainEqual(
      expect.objectContaining({
        componentId: "headline",
        property: "sizing.width",
      })
    );
  });

  // These four rules reject the whole document atomically in the protocol, so
  // Studio has to name the specific one rather than let an author publish and
  // discover the paywall was refused wholesale.
  it("rejects a tab condition whose target the protocol would refuse", () => {
    const store = createEditorStore();
    store.loadTemplate(
      cloneValue(required(EDITOR_TEMPLATES[0], "EDITOR_TEMPLATES[0]").document)
    );
    const tabsId = required(store.insertComponent("tabs"), "tabs id");
    const siblingId = required(store.insertComponent("text"), "sibling id");
    const tabs = findNode(
      required(store.getSnapshot().document, "document"),
      tabsId
    );
    if (tabs?.type !== "tabs") {
      throw new Error("Expected the inserted node to be a Tabs component");
    }
    const legalTabId = required(tabs.tabs[0], "tabs.tabs[0]").id;

    store.updateComponent(siblingId, (node) => ({
      ...node,
      visibility: { mode: "tab", tabsId, equals: legalTabId },
    }));
    expect(
      validateEditorDocument(
        required(store.getSnapshot().document, "document")
      ).filter((issue) => issue.componentId === siblingId)
    ).toEqual([]);

    store.updateComponent(siblingId, (node) => ({
      ...node,
      visibility: { mode: "tab", tabsId, equals: "no-such-tab" },
    }));
    expect(
      validateEditorDocument(required(store.getSnapshot().document, "document"))
    ).toContainEqual(
      expect.objectContaining({
        code: "visibility.invalidTabValue",
        componentId: siblingId,
      })
    );

    // Rule 4: a node inside a panel is already decided by that panel.
    store.selectComponent(required(tabs.tabs[0], "tabs.tabs[0]").content.id);
    const insideId = required(store.insertComponent("text"), "inside id");
    store.updateComponent(insideId, (node) => ({
      ...node,
      visibility: { mode: "tab", tabsId, equals: legalTabId },
    }));
    expect(
      validateEditorDocument(required(store.getSnapshot().document, "document"))
    ).toContainEqual(
      expect.objectContaining({
        code: "visibility.invalidTabController",
        componentId: insideId,
      })
    );
  });
});
