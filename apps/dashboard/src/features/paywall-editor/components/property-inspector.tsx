import { useMemo } from "react";

import { Button } from "@/components/ui/button";
import { LayerTypeIcon } from "@/features/paywall-editor/components/layer-type-icon";
import { ScrollContainerInspector } from "@/features/paywall-editor/components/property-inspector-basic-nodes";
import { InspectorForNode } from "@/features/paywall-editor/components/property-inspector-controls";
import {
  EMPTY_VALIDATION_ISSUES,
  InspectorContext,
  layerDisplayLabel,
  selectLayerMetadata,
} from "@/features/paywall-editor/components/property-inspector-core";
import { MotionSection } from "@/features/paywall-editor/components/property-inspector-motion";
import { useEditorSelection } from "@/features/paywall-editor/hooks/use-editor-selection";
import { useEditorStore } from "@/features/paywall-editor/stores/editor-store-context";
import {
  useStudioWorkspaceActions,
  useStudioWorkspaceSelector,
} from "@/features/paywall-editor/stores/studio-workspace-store-context";
import type { ValidationIssue } from "@/features/paywall-editor/types/editor";
import { findAncestorNodeIds } from "@/features/paywall-editor/utils/document-tree-traversal";

export function PropertyInspector({
  issues = EMPTY_VALIDATION_ISSUES,
}: {
  issues?: readonly ValidationIssue[];
}) {
  const { selectedComponent, selectedComponentId } = useEditorSelection();
  const { currentLocale, document } = useEditorStore();
  const metadata = useStudioWorkspaceSelector(selectLayerMetadata);
  const workspace = useStudioWorkspaceActions();
  const selectedScrollContainer = document
    ? (document.screens.find(
        (screen) => selectedComponentId === screen.layout.id
      )?.layout ?? null)
    : null;
  const selectedTarget = selectedScrollContainer ?? selectedComponent;
  const selectedLabel =
    selectedTarget && document
      ? layerDisplayLabel(document, selectedTarget.id, metadata.labels)
      : null;
  const selectedType = selectedScrollContainer?.type ?? selectedComponent?.type;
  const ancestorIds =
    selectedComponent && document
      ? findAncestorNodeIds(document, selectedComponent.id)
      : [];
  const ancestorIdSet = new Set(ancestorIds);
  const rawSelectionPath =
    selectedTarget && document
      ? ([
          selectedScrollContainer?.id ??
            document.screens.find((screen) =>
              selectedComponent
                ? ancestorIdSet.has(screen.layout.content.id) ||
                  selectedComponent.id === screen.layout.content.id
                : false
            )?.layout.id ??
            document.screens[0]?.layout.id,
          ...(selectedComponent ? [...ancestorIds, selectedComponent.id] : []),
        ] as Array<string | undefined>)
      : [];
  const selectionPath = [
    ...new Set(rawSelectionPath.filter((id): id is string => Boolean(id))),
  ];
  const selectedIssueCount = selectedTarget
    ? issues.filter((issue) => issue.componentId === selectedTarget.id).length
    : 0;
  const lockedIds = new Set(metadata.lockedIds);
  const lockedBy =
    document && selectedComponent
      ? [
          selectedComponent.id,
          ...findAncestorNodeIds(document, selectedComponent.id),
        ].find((id) => lockedIds.has(id))
      : undefined;
  const lockedLabel =
    lockedBy && document
      ? layerDisplayLabel(document, lockedBy, metadata.labels)
      : null;
  const inspectorContext = useMemo(
    () =>
      document && selectedTarget
        ? {
            componentId: selectedTarget.id,
            disabled: lockedBy !== undefined,
            document,
            issues,
            locale: currentLocale,
          }
        : null,
    [currentLocale, document, issues, lockedBy, selectedTarget]
  );

  return (
    <section aria-labelledby="property-inspector-title">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-2.5">
          {selectedType ? (
            <span
              aria-hidden
              className="mt-0.5 grid size-8 shrink-0 place-items-center rounded bg-muted text-muted-foreground"
            >
              <LayerTypeIcon type={selectedType} />
            </span>
          ) : null}
          <div className="min-w-0">
            <h2
              className="font-semibold text-sm focus:outline-none"
              id="property-inspector-title"
              tabIndex={-1}
            >
              Properties
            </h2>
            {selectionPath.length > 0 && document ? (
              <nav
                aria-label="Selected layer path"
                className="mt-0.5"
                title={selectedLabel ?? ""}
              >
                <ol className="flex min-w-0 items-center gap-1 overflow-hidden text-muted-foreground text-xs">
                  {selectionPath.map((id, index) => (
                    <li className="flex min-w-0 items-center gap-1" key={id}>
                      {index > 0 ? <span aria-hidden>/</span> : null}
                      <span className="truncate">
                        {layerDisplayLabel(document, id, metadata.labels)}
                      </span>
                    </li>
                  ))}
                </ol>
              </nav>
            ) : (
              <p className="mt-0.5 text-muted-foreground text-xs">
                Select content to edit it
              </p>
            )}
          </div>
        </div>
        {selectedTarget ? (
          <span className="rounded-full bg-muted px-2 py-1 font-medium text-[10px]">
            {selectedIssueCount} {selectedIssueCount === 1 ? "issue" : "issues"}
          </span>
        ) : null}
      </div>
      {selectedTarget && document && inspectorContext ? (
        <InspectorContext.Provider value={inspectorContext}>
          {lockedBy ? (
            <div
              className="mt-4 rounded border border-border bg-muted p-3 text-xs"
              role="status"
            >
              <p className="font-semibold">Properties are read-only</p>
              <p className="mt-1 text-muted-foreground">
                {lockedBy === selectedTarget.id
                  ? "This layer is locked."
                  : `Ancestor ${lockedLabel ?? "layer"} is locked.`}
              </p>
              <Button
                className="mt-2"
                onClick={() => workspace.setLayerLocked(lockedBy, false)}
                size="xs"
                type="button"
                variant="outline"
              >
                Unlock {lockedLabel ?? "layer"}
              </Button>
            </div>
          ) : null}
          <div className="-mx-4 mt-4 border-t">
            {(() => {
              if (selectedScrollContainer) {
                return (
                  <ScrollContainerInspector
                    key={selectedScrollContainer.id}
                    layout={selectedScrollContainer}
                  />
                );
              }
              if (selectedComponent) {
                return (
                  <>
                    <InspectorForNode
                      key={selectedComponent.id}
                      node={selectedComponent}
                    />
                    {/* Motion is authored per node on any component, so it sits
                        beside the type-specific inspector rather than inside
                        each of the seventeen of them. The screen Scroll
                        Container is excluded by the contract and is handled by
                        the branch above. */}
                    <MotionSection
                      key={`${selectedComponent.id}-motion`}
                      node={selectedComponent}
                    />
                  </>
                );
              }
              return null;
            })()}
          </div>
        </InspectorContext.Provider>
      ) : (
        <div className="mt-4 rounded bg-muted p-4 text-muted-foreground text-sm">
          Select a block in Layers or the Canvas to edit its Protocol 0.4
          properties.
        </div>
      )}
    </section>
  );
}
