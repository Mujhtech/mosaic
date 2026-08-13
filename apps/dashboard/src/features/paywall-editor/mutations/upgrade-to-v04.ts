import type {
  MosaicDocument,
  ProtocolNode,
} from "@/features/paywall-editor/types/editor";
import { cloneValue } from "@/features/paywall-editor/utils/clone";
import {
  documentRequiredCapabilities,
  isMotionCapableDocument,
  withDocumentParts,
  withNodeParts,
  withScreenParts,
} from "@/features/paywall-editor/utils/document-version";
import {
  type MosaicPaywallV04Document,
  paywallV04ContractVersion,
} from "@/lib/mosaic-protocol";

/**
 * Rewrite one node for 0.4.
 *
 * The only content change the migration makes to a node is Feature List's
 * marker: 0.3 pins the single constant `"checkmark"`, and 0.4 carries the
 * marker union Timeline already used. Timeline itself is untouched -- its 0.3
 * marker is already the 0.4 shape, which is precisely why 0.4 consolidated onto
 * it rather than inventing a third vocabulary.
 *
 * No `motion` block is added. Motion is authored after the upgrade, and a
 * migration that invented entrances would change what the paywall renders --
 * the one thing the contract promises this migration does not do.
 */
function upgradeNode(node: ProtocolNode): ProtocolNode {
  let next = node;
  if (next.type === "featureList" && next.marker === "checkmark") {
    next = withNodeParts(next, {
      marker: { kind: "icon", name: "checkmark" },
    });
  }
  switch (next.type) {
    case "stack":
    case "productCard":
    case "productBadge":
      return withNodeParts(next, { children: next.children.map(upgradeNode) });
    case "button":
      return withNodeParts(next, {
        children: next.children.map(upgradeNode),
        ...(next.inProgressChildren
          ? { inProgressChildren: next.inProgressChildren.map(upgradeNode) }
          : {}),
      });
    case "carousel":
      return withNodeParts(next, {
        pages: next.pages.map((page) => {
          const content = upgradeNode(page.content);
          return {
            ...page,
            content: content.type === "stack" ? content : page.content,
          };
        }),
      });
    case "tabs":
      return withNodeParts(next, {
        tabs: next.tabs.map((tab) => {
          const content = upgradeNode(tab.content);
          return {
            ...tab,
            content: content.type === "stack" ? content : tab.content,
          };
        }),
      });
    case "productSelector":
      return withNodeParts(next, {
        cards: next.cards.map((card) => {
          const mapped = upgradeNode(card);
          return mapped.type === "productCard" ? mapped : card;
        }),
      });
    default:
      return next;
  }
}

/**
 * The five mechanical steps that turn a 0.3 document into a 0.4 one.
 *
 * Taken verbatim from the migration section of `docs/protocol/v0.4.md`, which
 * is also the script that produced `protocol/fixtures/v0.4/` from
 * `protocol/fixtures/v0.3/`:
 *
 * 1. `schemaVersion` 0.3 to 0.4;
 * 2. every `compatibility.requiredCapabilities` entry's version to 0.4;
 * 3. remove any `style.productCardStates` entry;
 * 4. add an empty `motions` catalog to `designSystem`;
 * 5. rewrite every Feature List marker to the shared marker union.
 *
 * Steps 2 and 3 are handled together by `documentRequiredCapabilities`, which
 * derives the whole list from the protocol reference rather than editing the
 * declared one in place -- deriving cannot leave behind a capability the
 * document no longer needs, and editing in place can.
 *
 * Nothing else changes. The result renders identically, which is what makes the
 * one-way step safe to offer: the document gains the ability to carry motion
 * and loses nothing.
 */
export function upgradeDocumentToV04(
  document: MosaicDocument
): MosaicPaywallV04Document {
  if (isMotionCapableDocument(document)) {
    return cloneValue(document);
  }
  const source = cloneValue(document);
  // This function is the one place a document's contract version changes, so it
  // is also the one place the version-preserving helpers must not be used: they
  // exist precisely to stop every other call site from doing this. The
  // conversion is asserted here and then checked for real by
  // `validatePaywallDocument`, which is what the migration test asserts against.
  const upgraded = {
    ...source,
    schemaVersion: paywallV04ContractVersion,
    designSystem: { ...source.designSystem, motions: [] },
    screens: source.screens.map((screen) => {
      const content = upgradeNode(screen.layout.content);
      return withScreenParts(screen, {
        layout: {
          ...screen.layout,
          content: content.type === "stack" ? content : screen.layout.content,
        },
      });
    }),
  } as unknown as MosaicPaywallV04Document;
  // Derived last, so the declaration is computed against the already-upgraded
  // content and carries the 0.4 version stamp on every entry.
  return withDocumentParts(upgraded, {
    compatibility: {
      ...upgraded.compatibility,
      requiredCapabilities: documentRequiredCapabilities(upgraded),
    },
  });
}
