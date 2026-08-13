import type {
  AuthoredNodeMotion,
  DocumentCompatibility,
  MosaicDocument,
  MotionToken,
  ProtocolNode,
  Screen,
} from "@/features/paywall-editor/types/editor";
import { requiredCapabilitiesFor } from "@/lib/mosaic-protocol";

/**
 * The parts of a document the editor replaces wholesale.
 *
 * Now that every Mosaic contract carries exactly one version
 * (docs/architecture/decisions/0028-single-version-contracts.md) these are
 * plain checked spreads: the compiler verifies both the keys and the values,
 * where the two-version union used to force an assertion.
 */
export function withDocumentParts(
  document: MosaicDocument,
  parts: Partial<MosaicDocument>
): MosaicDocument {
  return { ...document, ...parts };
}

/**
 * Replace parts of a screen or node while preserving its concrete type.
 *
 * Unlike `withDocumentParts`, these stay key-checked but value-asserted: the
 * editor rebuilds subtrees by mapping children through the widened
 * `ProtocolNode` shape (a stack's children, a card's passive children), and
 * inspector controls narrow free-form input at the call site. The correlation
 * between a node and parts derived from that same node is the invariant the
 * caller holds and TypeScript cannot see.
 */
export function withScreenParts(
  screen: Screen,
  parts: { readonly [K in keyof Screen]?: unknown }
): Screen {
  return { ...screen, ...parts } as Screen;
}

/** See `withScreenParts`. */
export function withNodeParts<TNode extends ProtocolNode>(
  node: TNode,
  parts: { readonly [K in keyof TNode]?: unknown }
): TNode {
  return { ...node, ...parts } as TNode;
}

/**
 * The capabilities a document must declare, in canonical order.
 *
 * Delegates to the protocol reference implementation rather than deriving
 * capabilities by hand: an over-declared or under-declared capability is
 * rejected at delivery, and hand-derivation had already drifted from the
 * validator once.
 */
export function documentRequiredCapabilities(
  document: MosaicDocument
): DocumentCompatibility["requiredCapabilities"] {
  return [...requiredCapabilitiesFor(document)];
}

/**
 * A node's motion block, read through the authoring shape.
 *
 * Narrowing the three trigger-specific shapes by `in` yields `{}` rather than
 * the member type, because they differ only in optional members. Reading them
 * through one shape is both what the authoring surface wants and the only form
 * TypeScript handles cleanly; writes still go back through the node's own type.
 */
export function nodeMotionOf(
  node: ProtocolNode
): AuthoredNodeMotion | undefined {
  return "motion" in node
    ? (node.motion as AuthoredNodeMotion | undefined)
    : undefined;
}

/** The motion tokens a document declares. */
export function documentMotionTokens(
  document: MosaicDocument
): readonly MotionToken[] {
  return document.designSystem.motions;
}

/**
 * Whether a node sits underneath another node that already carries `appear`.
 *
 * The contract rejects the document in that case: two entrance opacities
 * multiply and the three renderers compose that product at different points,
 * so the contract refuses rather than pinning an arithmetic no platform
 * agrees on.
 */
export function findAppearAncestorId(
  document: MosaicDocument,
  nodeId: string
): string | null {
  let found: string | null = null;
  const visit = (node: ProtocolNode, appearAncestorId: string | null) => {
    if (found) {
      return;
    }
    if (node.id === nodeId) {
      found = appearAncestorId;
      return;
    }
    const nextAncestorId =
      "motion" in node && node.motion?.appear ? node.id : appearAncestorId;
    for (const child of childNodesOf(node)) {
      visit(child, nextAncestorId);
    }
  };
  for (const screen of document.screens) {
    visit(screen.layout.content, null);
  }
  return found;
}

/** Every descendant collection a node can carry, flattened. */
export function childNodesOf(node: ProtocolNode): readonly ProtocolNode[] {
  switch (node.type) {
    case "stack":
      return node.children;
    case "button":
      return [...node.children, ...(node.inProgressChildren ?? [])];
    case "carousel":
      return node.pages.map((page) => page.content);
    case "tabs":
      return node.tabs.map((tab) => tab.content);
    case "productSelector":
      return node.cards;
    case "productCard":
    case "productBadge":
      return node.children;
    default:
      return [];
  }
}
