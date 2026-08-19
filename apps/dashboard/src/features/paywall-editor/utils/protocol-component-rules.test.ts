import { describe, expect, it } from "vitest";
import { withTimelineStyleCoPresence } from "@/features/paywall-editor/components/property-inspector-content-blocks-support";
import { EDITOR_TEMPLATES } from "@/features/paywall-editor/constants/templates";
import { createEditorStore } from "@/features/paywall-editor/stores/editor-store";
import type {
  MosaicDocument,
  SocialProofRating,
  TabsComponent,
  TimelineComponent,
} from "@/features/paywall-editor/types/editor";
import { cloneValue } from "@/features/paywall-editor/utils/clone";
import { appendScreen } from "@/features/paywall-editor/utils/document-tree-creation";
import { findNode } from "@/features/paywall-editor/utils/document-tree-traversal";
import {
  announcementFor,
  eligibleTabControllers,
  ratingMaximumSteps,
  reconcileReservedAccessibilityStrings,
  socialProofRatingIsInBounds,
  timelineStyleCoPresenceHolds,
} from "@/features/paywall-editor/utils/protocol-component-rules";
import { validatePaywallDocument } from "@/lib/mosaic-protocol";
import { required } from "@/test/required";

function templateDocument(): MosaicDocument {
  return cloneValue(
    required(EDITOR_TEMPLATES[0], "EDITOR_TEMPLATES[0]").document
  );
}

function documentWith(type: "tabs" | "timeline" | "award" | "socialProof") {
  const store = createEditorStore();
  store.loadTemplate(templateDocument());
  const nodeId = store.insertComponent(type);
  return {
    document: required(store.getSnapshot().document, "document"),
    nodeId: required(nodeId, `${type} node id`),
    store,
  };
}

describe("Protocol 0.3 component authoring rules", () => {
  // A component that is invalid the moment it is inserted forces the author to
  // repair it before they can preview or publish anything, so the insert menu's
  // starting content is checked against the protocol itself rather than the
  // editor's own opinion of it.
  it.each(["tabs", "timeline", "award", "socialProof"] as const)(
    "inserts %s as a document the protocol accepts",
    (type) => {
      const { document } = documentWith(type);
      expect(validatePaywallDocument(document).diagnostics).toEqual([]);
    }
  );

  // markerColor, markerSize, and descriptionTypography are required exactly
  // when an entry consumes them and forbidden otherwise. Every inspector edit
  // that can flip that runs through withTimelineStyleCoPresence, so an author
  // dropping the last marker cannot leave a value nothing reads behind.
  it("keeps timeline marker and description styles co-present in both directions", () => {
    const { document, nodeId } = documentWith("timeline");
    const timeline = findNode(document, nodeId) as TimelineComponent;
    expect(timelineStyleCoPresenceHolds(timeline)).toBe(true);
    expect(timeline.markerColor).toBeDefined();
    expect(timeline.descriptionTypography).toBeDefined();

    const withoutMarkers = withTimelineStyleCoPresence({
      ...timeline,
      entries: timeline.entries.map(({ marker, ...entry }) => entry),
    });
    expect(withoutMarkers).not.toHaveProperty("markerColor");
    expect(withoutMarkers).not.toHaveProperty("markerSize");
    expect(withoutMarkers.descriptionTypography).toBeDefined();
    expect(timelineStyleCoPresenceHolds(withoutMarkers)).toBe(true);

    const withoutDescriptions = withTimelineStyleCoPresence({
      ...withoutMarkers,
      entries: withoutMarkers.entries.map(({ description, ...entry }) => entry),
    });
    expect(withoutDescriptions).not.toHaveProperty("descriptionTypography");
    expect(timelineStyleCoPresenceHolds(withoutDescriptions)).toBe(true);

    const markerRestored = withTimelineStyleCoPresence({
      ...withoutDescriptions,
      entries: withoutDescriptions.entries.map((entry, index) =>
        index === 0 ? { ...entry, marker: { kind: "dot" as const } } : entry
      ),
    });
    expect(markerRestored.markerColor).toBeDefined();
    expect(markerRestored.markerSize).toBeDefined();
    expect(timelineStyleCoPresenceHolds(markerRestored)).toBe(true);
  });

  // value counts steps, not points. A control that wrote points would render a
  // different number of stars on every runtime that rounds the fraction its
  // own way, and a value past the bound rejects the whole document.
  it("counts a social proof rating in steps and refuses to exceed its bound", () => {
    const halfStars: SocialProofRating = {
      symbol: "star",
      value: 9,
      maximum: 5,
      step: "half",
      size: 16,
      filledColor: "action.primary",
      emptyColor: "border.default",
    };
    expect(ratingMaximumSteps(halfStars)).toBe(10);
    expect(socialProofRatingIsInBounds(halfStars)).toBe(true);
    expect(socialProofRatingIsInBounds({ ...halfStars, value: 10 })).toBe(true);
    expect(socialProofRatingIsInBounds({ ...halfStars, value: 11 })).toBe(
      false
    );

    const wholeStars: SocialProofRating = { ...halfStars, step: "whole" };
    expect(ratingMaximumSteps(wholeStars)).toBe(5);
    expect(socialProofRatingIsInBounds({ ...wholeStars, value: 5 })).toBe(true);
    expect(socialProofRatingIsInBounds({ ...wholeStars, value: 6 })).toBe(
      false
    );
  });

  // The protocol rejects a tab condition atomically when its target is off the
  // screen, is the Tabs component itself, or contains the referencing node, so
  // the inspector must never offer one of those as a choice.
  it("offers a Tabs controller only where the protocol would accept it", () => {
    const { document, nodeId, store } = documentWith("tabs");
    const tabs = findNode(document, nodeId) as TabsComponent;
    const firstTab = required(tabs.tabs[0], "tabs.tabs[0]");

    // A sibling on the same screen may name it.
    const siblingId = required(
      store.insertComponent("text"),
      "sibling text node"
    );
    const withSibling = required(store.getSnapshot().document, "document");
    expect(
      eligibleTabControllers(withSibling, siblingId).map(
        (candidate) => candidate.id
      )
    ).toContain(tabs.id);

    // The Tabs component itself may not.
    expect(
      eligibleTabControllers(withSibling, tabs.id).map(
        (candidate) => candidate.id
      )
    ).not.toContain(tabs.id);

    // Nor may a node inside one of its own panels: the condition there is
    // already decided by the panel, so it is dead layout either way.
    store.selectComponent(firstTab.content.id);
    const insideId = required(
      store.insertComponent("text"),
      "text inside the first panel"
    );
    const withPanelChild = required(store.getSnapshot().document, "document");
    expect(
      eligibleTabControllers(withPanelChild, insideId).map(
        (candidate) => candidate.id
      )
    ).not.toContain(tabs.id);

    // Nor may a node on another screen.
    const secondScreen = appendScreen(withPanelChild);
    expect(
      eligibleTabControllers(
        secondScreen.document,
        secondScreen.selectionId
      ).map((candidate) => candidate.id)
    ).not.toContain(tabs.id);
  });

  // Segments are separate accessibility elements and the protocol's separator
  // is null by contract, so nothing may join them. The connective inside a
  // rating belongs to the authored mosaic.a11y.rating template: composing
  // either here would emit English word order in every locale and a different
  // string from the one the three SDKs announce.
  it("takes announced segments from the reference without joining them", () => {
    const { document, nodeId } = documentWith("socialProof");
    const socialProof = required(findNode(document, nodeId), "social proof");

    const english = announcementFor(document, socialProof, "en");
    if (english.status !== "announced") {
      throw new Error(english.message);
    }
    expect(english.announcement.separator).toBeNull();
    expect(english.announcement.composition).toBe("separateElements");
    // No avatar was authored, so nothing is listed as decorative.
    expect(english.announcement.decorative).toEqual([]);
    expect(
      english.announcement.elements.map((element) => element.segment)
    ).toEqual(["rating", "quote", "attribution"]);
    // value 9 counts half-steps, so it announces as 4.5 points, never as 9.
    expect(english.announcement.elements[0]?.text).toBe("4.5 out of 5 stars");

    const german = announcementFor(document, socialProof, "de");
    if (german.status !== "announced") {
      throw new Error(german.message);
    }
    expect(german.announcement.elements[0]?.text).toBe("4.5 von 5 Sternen");

    // An absent optional segment produces no element, never an empty one.
    const unrated = cloneValue(document);
    const withoutRating = required(findNode(unrated, nodeId), "social proof");
    if (withoutRating.type !== "socialProof") {
      throw new Error("Expected a Social Proof node");
    }
    delete withoutRating.rating;
    const unratedAnnouncement = announcementFor(
      reconcileReservedAccessibilityStrings(unrated),
      withoutRating,
      "en"
    );
    if (unratedAnnouncement.status !== "announced") {
      throw new Error(unratedAnnouncement.message);
    }
    expect(
      unratedAnnouncement.announcement.elements.map((item) => item.segment)
    ).toEqual(["quote", "attribution"]);

    // A missing reserved string is reported, never replaced by a composed one.
    const withoutTemplate = cloneValue(document);
    for (const catalog of Object.values(withoutTemplate.localization.locales)) {
      delete catalog.strings["mosaic.a11y.rating"];
    }
    expect(announcementFor(withoutTemplate, socialProof, "en").status).toBe(
      "unavailable"
    );
  });
});
