import { ArrowDownIcon } from "@phosphor-icons/react/dist/ssr/ArrowDown"
import { ArrowUpIcon } from "@phosphor-icons/react/dist/ssr/ArrowUp"
import { PlusIcon } from "@phosphor-icons/react/dist/ssr/Plus"
import { TrashIcon } from "@phosphor-icons/react/dist/ssr/Trash"
import { useState } from "react"

import { Button } from "@/components/ui/button"
import { INSERTABLE_BLOCKS } from "@/features/paywall-editor/constants/editor-constants"
import {
  useEditorActions,
  useEditorStore,
} from "@/features/paywall-editor/stores/editor-store-context"
import type { InsertableBlockType, ProtocolNode } from "@/features/paywall-editor/types/editor"
import { findParent, flattenDocument } from "@/features/paywall-editor/utils/document-tree"

const NODE_LABELS: Record<ProtocolNode["type"], string> = {
  verticalStack: "Stack",
  text: "Text",
  image: "Image",
  featureList: "Feature list",
  productSelector: "Product selector",
  purchaseButton: "Purchase button",
  restoreButton: "Restore button",
  closeButton: "Close button",
  legalText: "Legal text",
}

function TreeNode({ node, depth }: { node: ProtocolNode; depth: number }) {
  const { selectedComponentId } = useEditorStore()
  const { selectComponent } = useEditorActions()
  const selected = selectedComponentId === node.id

  return (
    <li>
      <button
        type="button"
        className={`focus-visible:ring-ring flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-sm focus-visible:ring-2 focus-visible:outline-none ${
          selected ? "bg-primary/10 text-primary font-medium" : "hover:bg-muted"
        }`}
        style={{ paddingInlineStart: `${8 + depth * 14}px` }}
        onClick={() => selectComponent(node.id)}
      >
        <span className="bg-border block size-1.5 shrink-0 rounded-full" aria-hidden />
        <span className="min-w-0 flex-1 truncate">{NODE_LABELS[node.type]}</span>
      </button>
      {node.type === "verticalStack" ? (
        <ul>
          {node.children.map((child) => (
            <TreeNode key={child.id} node={child} depth={depth + 1} />
          ))}
        </ul>
      ) : null}
    </li>
  )
}

export function ComponentTree() {
  const { document, selectedComponentId } = useEditorStore()
  const { insertComponent, moveSelectedComponent, removeSelectedComponent } = useEditorActions()
  const [insertType, setInsertType] = useState<InsertableBlockType>("text")

  if (!document) return null
  const selectedParent = findParent(document, selectedComponentId)
  const hasProductSelector = flattenDocument(document).some(
    (entry) => entry.node.type === "productSelector",
  )
  const canRemoveSelected = Boolean(selectedParent && selectedParent.parent.children.length > 1)

  return (
    <section aria-labelledby="component-tree-title">
      <div className="mb-3 flex items-center justify-between">
        <div>
          <h2 id="component-tree-title" className="text-sm font-semibold">
            Paywall order
          </h2>
          <p className="text-muted-foreground mt-0.5 text-xs">Select, move, or remove content</p>
        </div>
        <div className="flex gap-1">
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label="Move selected component up"
            disabled={!selectedComponentId}
            onClick={() => moveSelectedComponent(-1)}
          >
            <ArrowUpIcon aria-hidden />
          </Button>
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label="Move selected component down"
            disabled={!selectedComponentId}
            onClick={() => moveSelectedComponent(1)}
          >
            <ArrowDownIcon aria-hidden />
          </Button>
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label="Remove selected component"
            disabled={!canRemoveSelected}
            onClick={removeSelectedComponent}
          >
            <TrashIcon aria-hidden />
          </Button>
        </div>
      </div>

      <ul className="space-y-0.5" aria-label="Paywall component tree">
        {document.layout.content.children.map((node) => (
          <TreeNode key={node.id} node={node} depth={0} />
        ))}
      </ul>

      <div className="border-border mt-4 border-t pt-4">
        <label
          className="text-muted-foreground mb-1.5 block text-xs font-medium"
          htmlFor="block-type"
        >
          {document.layout.content.children.some((node) => node.id === selectedComponentId)
            ? "Add after selected content"
            : "Add to end of paywall"}
        </label>
        <div className="flex gap-2">
          <select
            id="block-type"
            className="border-input bg-background focus-visible:ring-ring min-w-0 flex-1 rounded-md border px-2 py-2 text-sm focus-visible:ring-2 focus-visible:outline-none"
            value={insertType}
            onChange={(event) => setInsertType(event.target.value as InsertableBlockType)}
          >
            {INSERTABLE_BLOCKS.map((entry) => (
              <option
                key={entry.type}
                value={entry.type}
                disabled={entry.type === "productSelector" && hasProductSelector}
              >
                {entry.label}
                {entry.type === "productSelector" && hasProductSelector ? " (already added)" : ""}
              </option>
            ))}
          </select>
          <Button
            size="sm"
            aria-label={`Insert ${insertType}`}
            onClick={() => insertComponent(insertType)}
          >
            <PlusIcon aria-hidden />
            Add
          </Button>
        </div>
      </div>
    </section>
  )
}
