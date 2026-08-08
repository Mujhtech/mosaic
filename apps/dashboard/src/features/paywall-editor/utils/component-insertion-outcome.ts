import type {
  InsertableBlockType,
  MosaicDocument,
} from "@/features/paywall-editor/types/editor";
import {
  insertBlockAtLocation,
  resolveLegacyInsertionLocation,
} from "@/features/paywall-editor/utils/document-tree-mutations";
import {
  findAncestorNodeIds,
  findNode,
} from "@/features/paywall-editor/utils/document-tree-traversal";

export interface InsertionBlocker {
  readonly detail: string;
  readonly title: string;
}

export interface InsertionEnvironment {
  readonly countdownEndsAt: string | null;
  readonly document: MosaicDocument;
  readonly isDocumentTransactionActive: boolean;
  readonly lockedIds: readonly string[];
  readonly selectedComponentId: string | null;
}

function destinationIsLocked(
  document: MosaicDocument,
  parentId: string,
  lockedIds: readonly string[]
) {
  const locked = new Set(lockedIds);
  return (
    locked.has(parentId) ||
    findAncestorNodeIds(document, parentId).some((ancestorId) =>
      locked.has(ancestorId)
    )
  );
}

/**
 * The four environmental reasons an insertion is refused before the document is
 * ever consulted. Shared so the library's notice and the component preview card
 * cannot disagree about why a component is unavailable.
 */
export function insertionBlocker(
  environment: InsertionEnvironment,
  type: InsertableBlockType
): InsertionBlocker | null {
  const { document, selectedComponentId } = environment;
  if (environment.isDocumentTransactionActive) {
    return {
      title: "Finish the current edit first.",
      detail:
        "Commit or cancel the active text or property edit, then insert the component.",
    };
  }
  const location = resolveLegacyInsertionLocation(
    document,
    selectedComponentId,
    type
  );
  const parent = findNode(document, location.parentId);
  const validParent =
    parent?.type === "stack" ||
    parent?.type === "button" ||
    parent?.type === "productCard" ||
    parent?.type === "productBadge";
  if (!validParent) {
    return {
      title: "The insertion Stack is no longer available.",
      detail: "Select Content Stack or another visible Stack and try again.",
    };
  }
  if (destinationIsLocked(document, location.parentId, environment.lockedIds)) {
    return {
      title: "The insertion Stack is locked.",
      detail:
        "Open Layers and unlock the destination Stack before adding content.",
    };
  }
  if (type === "countdown" && !environment.countdownEndsAt) {
    return {
      title: "Countdown needs a valid deadline.",
      detail:
        "Enter an explicit UTC date and time before inserting or dragging Countdown.",
    };
  }
  return null;
}

export type InsertionDryRun =
  | { readonly blocker: InsertionBlocker; readonly status: "blocked" }
  | {
      /** The document insertion would produce, dependencies reconciled. */
      readonly document: MosaicDocument;
      readonly nodeId: string;
      readonly status: "accepted";
    };

/**
 * Everything `insertionBlocker` catches, plus a real, discarded run of the
 * insertion itself.
 *
 * Two things fall out of running the mutation rather than restating it: the
 * card reports document-level refusals in the mutation's own words, and on
 * acceptance it hands back the document insertion would have committed — with
 * localization catalogs, reserved accessibility strings and asset dependencies
 * already reconciled. Previewing the node against that document is what stops
 * the card showing a "missing string" defect that inserting would never
 * produce.
 */
export function dryRunInsertion(
  environment: InsertionEnvironment,
  type: InsertableBlockType
): InsertionDryRun {
  const environmental = insertionBlocker(environment, type);
  if (environmental) {
    return { status: "blocked", blocker: environmental };
  }
  const { document, selectedComponentId } = environment;
  const result = insertBlockAtLocation(
    document,
    type,
    resolveLegacyInsertionLocation(document, selectedComponentId, type),
    type === "countdown"
      ? { countdownEndsAt: environment.countdownEndsAt ?? undefined }
      : undefined
  );
  if (result.status === "rejected") {
    return {
      status: "blocked",
      blocker: { title: result.message, detail: result.recovery },
    };
  }
  return {
    status: "accepted",
    document: result.document,
    nodeId: result.nodeId,
  };
}
