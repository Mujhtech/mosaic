import { useMemo } from "react"

import { Button } from "@/components/ui/button"
import { LayerTypeIcon } from "@/features/paywall-editor/components/layer-type-icon"
import { useEditorSelection } from "@/features/paywall-editor/hooks/use-editor-selection"
import { useEditorStore } from "@/features/paywall-editor/stores/editor-store-context"
import {
  useStudioWorkspaceActions,
  useStudioWorkspaceSelector,
} from "@/features/paywall-editor/stores/studio-workspace-store-context"
import type { ValidationIssue } from "@/features/paywall-editor/types/editor"
import { findAncestorNodeIds } from "@/features/paywall-editor/utils/document-tree"

import { ScrollContainerInspector } from "@/features/paywall-editor/components/property-inspector-basic-nodes"
import { InspectorForNode } from "@/features/paywall-editor/components/property-inspector-controls"
import {
  EMPTY_VALIDATION_ISSUES,
  InspectorContext,
  layerDisplayLabel,
  selectLayerMetadata,
} from "@/features/paywall-editor/components/property-inspector-core"

export function PropertyInspector({
  issues = EMPTY_VALIDATION_ISSUES,
}: {
  issues?: readonly ValidationIssue[]
}) {
  const { selectedComponent, selectedComponentId } = useEditorSelection()
  const { currentLocale, document } = useEditorStore()
  const metadata = useStudioWorkspaceSelector(selectLayerMetadata)
  const workspace = useStudioWorkspaceActions()
  const selectedScrollContainer = document
    ? (document.screens.find((screen) => selectedComponentId === screen.layout.id)?.layout ?? null)
    : null
  const selectedTarget = selectedScrollContainer ?? selectedComponent
  const selectedLabel =
    selectedTarget && document
      ? layerDisplayLabel(document, selectedTarget.id, metadata.labels)
      : null
  const selectedType = selectedScrollContainer?.type ?? selectedComponent?.type
  const ancestorIds =
    selectedComponent && document ? findAncestorNodeIds(document, selectedComponent.id) : []
  const ancestorIdSet = new Set(ancestorIds)
  const rawSelectionPath =
    selectedTarget && document
      ? ([
          selectedScrollContainer?.id ??
            document.screens.find((screen) =>
              selectedComponent
                ? ancestorIdSet.has(screen.layout.content.id) ||
                  selectedComponent.id === screen.layout.content.id
                : false,
            )?.layout.id ??
            document.screens[0]?.layout.id,
          ...(selectedComponent ? [...ancestorIds, selectedComponent.id] : []),
        ] as Array<string | undefined>)
      : []
  const selectionPath = [...new Set(rawSelectionPath.filter((id): id is string => Boolean(id)))]
  const selectedIssueCount = selectedTarget
    ? issues.filter((issue) => issue.componentId === selectedTarget.id).length
    : 0
  const lockedIds = new Set(metadata.lockedIds)
  const lockedBy =
    document && selectedComponent
      ? [selectedComponent.id, ...findAncestorNodeIds(document, selectedComponent.id)].find((id) =>
          lockedIds.has(id),
        )
      : undefined
  const lockedLabel =
    lockedBy && document ? layerDisplayLabel(document, lockedBy, metadata.labels) : null
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
    [currentLocale, document, issues, lockedBy, selectedTarget],
  )

  return (
    <section aria-labelledby="property-inspector-title">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-2.5">
          {selectedType ? (
            <span
              aria-hidden
              className="bg-muted text-muted-foreground mt-0.5 grid size-8 shrink-0 place-items-center rounded-lg"
            >
              <LayerTypeIcon type={selectedType} />
            </span>
          ) : null}
          <div className="min-w-0">
            <h2
              className="text-sm font-semibold focus:outline-none"
              id="property-inspector-title"
              tabIndex={-1}
            >
              Properties
            </h2>
            {selectionPath.length > 0 && document ? (
              <nav aria-label="Selected layer path" className="mt-0.5" title={selectedLabel ?? ""}>
                <ol className="text-muted-foreground flex min-w-0 items-center gap-1 overflow-hidden text-xs">
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
              <p className="text-muted-foreground mt-0.5 text-xs">Select content to edit it</p>
            )}
          </div>
        </div>
        {selectedTarget ? (
          <span className="bg-muted rounded-full px-2 py-1 text-[10px] font-medium">
            {selectedIssueCount} {selectedIssueCount === 1 ? "issue" : "issues"}
          </span>
        ) : null}
      </div>
      {!selectedTarget || !document ? (
        <div className="bg-muted text-muted-foreground mt-4 rounded-xl p-4 text-sm">
          Select a block in Layers or the Canvas to edit its Protocol 0.2 properties.
        </div>
      ) : (
        <InspectorContext.Provider value={inspectorContext!}>
          {lockedBy ? (
            <div
              className="border-border bg-muted mt-4 rounded-lg border p-3 text-xs"
              role="status"
            >
              <p className="font-semibold">Properties are read-only</p>
              <p className="text-muted-foreground mt-1">
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
            {selectedScrollContainer ? (
              <ScrollContainerInspector
                key={selectedScrollContainer.id}
                layout={selectedScrollContainer}
              />
            ) : selectedComponent ? (
              <InspectorForNode key={selectedComponent.id} node={selectedComponent} />
            ) : null}
          </div>
        </InspectorContext.Provider>
      )}
    </section>
  )
}
