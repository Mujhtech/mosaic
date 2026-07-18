import { CreditCardIcon } from "@phosphor-icons/react/dist/ssr/CreditCard"
import { CursorClickIcon } from "@phosphor-icons/react/dist/ssr/CursorClick"
import { ImageIcon } from "@phosphor-icons/react/dist/ssr/Image"
import { ListChecksIcon } from "@phosphor-icons/react/dist/ssr/ListChecks"
import { MagnifyingGlassIcon } from "@phosphor-icons/react/dist/ssr/MagnifyingGlass"
import { PlusIcon } from "@phosphor-icons/react/dist/ssr/Plus"
import { SlideshowIcon } from "@phosphor-icons/react/dist/ssr/Slideshow"
import { ShapesIcon } from "@phosphor-icons/react/dist/ssr/Shapes"
import { StackIcon } from "@phosphor-icons/react/dist/ssr/Stack"
import { TextTIcon } from "@phosphor-icons/react/dist/ssr/TextT"
import { TimerIcon } from "@phosphor-icons/react/dist/ssr/Timer"
import { ToggleRightIcon } from "@phosphor-icons/react/dist/ssr/ToggleRight"
import { StatusMessage } from "@mosaic/design-system"
import { useState } from "react"
import type { DragEvent, KeyboardEvent } from "react"

import { Button } from "@/components/ui/button"
import {
  COMPONENT_CATALOG_BY_TYPE,
  COMPONENT_CATEGORIES,
  COMPONENT_LIBRARY_COUNTDOWN_ENDS_AT_DRAG_TYPE,
  COMPONENT_LIBRARY_DRAG_TYPE,
  type ComponentCatalogEntry,
} from "@/features/paywall-editor/components/component-catalog"
import type { EditorState } from "@/features/paywall-editor/stores/editor-store"
import {
  useEditorActions,
  useEditorStoreSelector,
} from "@/features/paywall-editor/stores/editor-store-context"
import type { StudioWorkspaceSnapshot } from "@/features/paywall-editor/stores/studio-workspace-store"
import {
  useStudioWorkspaceActions,
  useStudioWorkspaceSelector,
} from "@/features/paywall-editor/stores/studio-workspace-store-context"
import type {
  InsertableBlockType,
  TreeOperationResult,
} from "@/features/paywall-editor/types/editor"
import {
  findAncestorNodeIds,
  findNode,
  resolveLegacyInsertionLocation,
} from "@/features/paywall-editor/utils/document-tree"
import { countdownInstantFromLocalInput } from "@/features/paywall-editor/utils/countdown"

const selectInsertionState = (state: EditorState) => ({
  document: state.document,
  isDocumentTransactionActive: state.isDocumentTransactionActive,
  selectedComponentId: state.selectedComponentId,
})
const selectLibraryWorkspace = (snapshot: StudioWorkspaceSnapshot) => ({
  layerMetadata: snapshot.preferences.layerMetadata,
  recentInsertions: snapshot.preferences.recentInsertions,
})

interface LibraryNotice {
  readonly tone: "success" | "danger"
  readonly title: string
  readonly detail: string
}

function CatalogIcon({ type }: { type: InsertableBlockType }) {
  switch (type) {
    case "stack":
      return <StackIcon aria-hidden />
    case "carousel":
      return <SlideshowIcon aria-hidden />
    case "switch":
      return <ToggleRightIcon aria-hidden />
    case "countdown":
      return <TimerIcon aria-hidden />
    case "text":
      return <TextTIcon aria-hidden />
    case "image":
      return <ImageIcon aria-hidden />
    case "icon":
      return <ShapesIcon aria-hidden />
    case "featureList":
      return <ListChecksIcon aria-hidden />
    case "productSelector":
      return <CreditCardIcon aria-hidden />
    case "button":
      return <CursorClickIcon aria-hidden />
  }
}

function insertionPreview(
  document: NonNullable<EditorState["document"]>,
  selectedComponentId: string | null,
  labels: Readonly<Record<string, string>>,
) {
  const selected = findNode(document, selectedComponentId)
  if (
    selected?.type === "stack" ||
    selected?.type === "button" ||
    selected?.type === "productCard" ||
    selected?.type === "productBadge"
  ) {
    const root = document.screens.some((screen) => selected.id === screen.layout.content.id)
    const fallback =
      selected.type === "button"
        ? "Button"
        : selected.type === "productCard"
          ? "Product Card"
          : selected.type === "productBadge"
            ? "Product Badge"
            : "Stack"
    return `Inside ${labels[selected.id]?.trim() || (root ? "Content Stack" : fallback)}, after its current content.`
  }
  if (selected) {
    return `After ${labels[selected.id]?.trim() || COMPONENT_CATALOG_BY_TYPE.get(selected.type)?.label || selected.type}.`
  }
  return "At the end of Content Stack."
}

function insertionBlockedByLock(
  document: NonNullable<EditorState["document"]>,
  parentId: string,
  lockedIds: readonly string[],
) {
  const locked = new Set(lockedIds)
  return (
    locked.has(parentId) ||
    findAncestorNodeIds(document, parentId).some((ancestorId) => locked.has(ancestorId))
  )
}

export function ComponentLibrary() {
  const { document, isDocumentTransactionActive, selectedComponentId } =
    useEditorStoreSelector(selectInsertionState)
  const editor = useEditorActions()
  const { layerMetadata, recentInsertions } = useStudioWorkspaceSelector(selectLibraryWorkspace)
  const workspace = useStudioWorkspaceActions()
  const [query, setQuery] = useState("")
  const [selectedType, setSelectedType] = useState<InsertableBlockType>("text")
  const [countdownDeadlineInput, setCountdownDeadlineInput] = useState("")
  const [notice, setNotice] = useState<LibraryNotice | null>(null)

  if (!document) return null
  const activeDocument = document

  const location = resolveLegacyInsertionLocation(activeDocument, selectedComponentId, selectedType)
  const parent = findNode(activeDocument, location.parentId)
  const validParent =
    parent?.type === "stack" ||
    parent?.type === "button" ||
    parent?.type === "productCard" ||
    parent?.type === "productBadge"
      ? parent
      : null
  const destinationLocked = insertionBlockedByLock(
    activeDocument,
    location.parentId,
    layerMetadata.lockedIds,
  )
  const normalizedQuery = query.trim().toLocaleLowerCase()
  const filteredCategories = COMPONENT_CATEGORIES.map((category) => ({
    ...category,
    entries: category.entries.filter(
      (entry) =>
        !normalizedQuery ||
        entry.label.toLocaleLowerCase().includes(normalizedQuery) ||
        entry.description.toLocaleLowerCase().includes(normalizedQuery),
    ),
  })).filter((category) => category.entries.length > 0)
  const selectedEntry = COMPONENT_CATALOG_BY_TYPE.get(selectedType)
  const countdownEndsAt = countdownInstantFromLocalInput(countdownDeadlineInput)
  const countdownDeadlineReady = selectedType !== "countdown" || Boolean(countdownEndsAt)
  const insertionDisabled =
    isDocumentTransactionActive || !validParent || destinationLocked || !countdownDeadlineReady

  function selectType(type: InsertableBlockType) {
    setSelectedType(type)
    setNotice(null)
  }

  function reportResult(result: TreeOperationResult, type: InsertableBlockType, label: string) {
    if (result.status === "accepted") {
      workspace.recordRecentInsertion(type)
      setNotice({
        tone: "success",
        title: `${label} inserted`,
        detail: "The new component is selected and the change can be undone.",
      })
      return
    }
    setNotice({ tone: "danger", title: result.message, detail: result.recovery })
  }

  function explainBlocked(type: InsertableBlockType) {
    if (isDocumentTransactionActive) {
      setNotice({
        tone: "danger",
        title: "Finish the current edit first.",
        detail: "Commit or cancel the active text or property edit, then insert the component.",
      })
      return true
    }
    if (!validParent) {
      setNotice({
        tone: "danger",
        title: "The insertion Stack is no longer available.",
        detail: "Select Content Stack or another visible Stack and try again.",
      })
      return true
    }
    if (destinationLocked) {
      setNotice({
        tone: "danger",
        title: "The insertion Stack is locked.",
        detail: "Open Layers and unlock the destination Stack before adding content.",
      })
      return true
    }
    if (type === "countdown" && !countdownEndsAt) {
      setNotice({
        tone: "danger",
        title: "Countdown needs a valid deadline.",
        detail: "Enter an explicit UTC date and time before inserting or dragging Countdown.",
      })
      return true
    }
    return false
  }

  function insert(type: InsertableBlockType) {
    setSelectedType(type)
    if (explainBlocked(type)) return
    const entry = COMPONENT_CATALOG_BY_TYPE.get(type)
    const label = entry?.label ?? type
    const insertionLocation = resolveLegacyInsertionLocation(
      activeDocument,
      selectedComponentId,
      type,
    )

    reportResult(
      editor.insertComponentAt(
        type,
        insertionLocation,
        type === "countdown" ? { countdownEndsAt: countdownEndsAt ?? undefined } : undefined,
      ),
      type,
      label,
    )
  }

  function handleCardKeyDown(
    event: KeyboardEvent<HTMLButtonElement>,
    entry: ComponentCatalogEntry,
  ) {
    if (event.key !== "Enter" && event.key !== " ") return
    event.preventDefault()
    selectType(entry.type)
    insert(entry.type)
  }

  function handleCardDragStart(event: DragEvent<HTMLButtonElement>, entry: ComponentCatalogEntry) {
    if (explainBlocked(entry.type)) {
      event.preventDefault()
      return
    }
    event.dataTransfer.effectAllowed = "copy"
    event.dataTransfer.setData(COMPONENT_LIBRARY_DRAG_TYPE, entry.type)
    event.dataTransfer.setData("text/plain", entry.type)
    if (entry.type === "countdown" && countdownEndsAt) {
      event.dataTransfer.setData(COMPONENT_LIBRARY_COUNTDOWN_ENDS_AT_DRAG_TYPE, countdownEndsAt)
    }
  }

  return (
    <section aria-labelledby="component-library-title" className="space-y-4">
      <div>
        <h2 className="text-sm font-semibold" id="component-library-title">
          Add content
        </h2>
        <p className="text-muted-foreground mt-0.5 text-xs leading-5">
          Insert only protocol-supported blocks into the selected Stack position.
        </p>
      </div>
      <div>
        <label
          className="text-muted-foreground mb-1.5 block text-xs font-medium"
          htmlFor="component-search"
        >
          Search components
        </label>
        <div className="relative">
          <MagnifyingGlassIcon
            aria-hidden
            className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2"
          />
          <input
            className="border-input bg-background focus-visible:ring-ring w-full rounded-md border py-2 pr-3 pl-8 text-sm focus-visible:ring-2 focus-visible:outline-none"
            id="component-search"
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Text, Button, Icon…"
            type="search"
            value={query}
          />
        </div>
      </div>

      {recentInsertions.length > 0 ? (
        <div>
          <h3 className="text-muted-foreground mb-1.5 text-xs font-semibold">Recent</h3>
          <div aria-label="Recent insertions" className="flex flex-wrap gap-1.5" role="list">
            {recentInsertions.map((type) => {
              const entry = COMPONENT_CATALOG_BY_TYPE.get(type)
              if (!entry) return null
              return (
                <Button
                  aria-pressed={selectedType === type}
                  className="h-7 transition-none motion-reduce:transition-none"
                  key={type}
                  onClick={() => selectType(type)}
                  size="sm"
                  type="button"
                  variant="outline"
                >
                  <CatalogIcon type={type} />
                  {entry.label}
                </Button>
              )
            })}
          </div>
        </div>
      ) : null}

      {filteredCategories.length > 0 ? (
        <div className="space-y-4">
          {filteredCategories.map((category) => (
            <section aria-labelledby={`component-category-${category.label}`} key={category.label}>
              <h3
                className="text-muted-foreground mb-1.5 text-xs font-semibold"
                id={`component-category-${category.label}`}
              >
                {category.label}
              </h3>
              <ul className="grid gap-1.5">
                {category.entries.map((entry) => {
                  const selected = selectedType === entry.type
                  const countdownDragReady = entry.type !== "countdown" || Boolean(countdownEndsAt)
                  return (
                    <li key={entry.type}>
                      <button
                        aria-describedby={`component-description-${entry.type}`}
                        aria-label={entry.label}
                        aria-pressed={selected}
                        className={`focus-visible:ring-ring flex w-full items-start gap-2 rounded-lg border p-2.5 text-left focus-visible:ring-2 focus-visible:outline-none ${
                          selected
                            ? "border-primary bg-primary/5"
                            : "border-border bg-background hover:bg-muted/60"
                        }`}
                        draggable={
                          countdownDragReady && !destinationLocked && !isDocumentTransactionActive
                        }
                        onClick={() => selectType(entry.type)}
                        onDoubleClick={() => insert(entry.type)}
                        onDragStart={(event) => handleCardDragStart(event, entry)}
                        onKeyDown={(event) => handleCardKeyDown(event, entry)}
                        type="button"
                      >
                        <span className="bg-muted text-foreground grid size-8 shrink-0 place-items-center rounded-md">
                          <CatalogIcon type={entry.type} />
                        </span>
                        <span className="min-w-0">
                          <span className="block text-sm font-medium">{entry.label}</span>
                          <span
                            className="text-muted-foreground mt-0.5 block text-xs leading-4"
                            id={`component-description-${entry.type}`}
                          >
                            {entry.description}
                          </span>
                        </span>
                      </button>
                    </li>
                  )
                })}
              </ul>
            </section>
          ))}
        </div>
      ) : (
        <div className="border-border rounded-lg border border-dashed p-4 text-center">
          <p className="text-sm font-medium">No supported components match</p>
          <p className="text-muted-foreground mt-1 text-xs">
            Try a protocol type such as Text or Button.
          </p>
        </div>
      )}

      <div className="border-border bg-muted/35 rounded-lg border p-3">
        <p className="text-xs font-semibold">Insertion target</p>
        <p className="text-muted-foreground mt-1 text-xs leading-4">
          {insertionPreview(document, selectedComponentId, layerMetadata.labels)}
        </p>
      </div>

      {selectedType === "countdown" ? (
        <div className="space-y-1.5">
          <label
            className="text-muted-foreground block text-xs font-medium"
            htmlFor="countdown-insertion-deadline"
          >
            Deadline (UTC)
          </label>
          <input
            aria-describedby="countdown-insertion-deadline-description"
            className="border-input bg-background focus-visible:ring-ring w-full rounded-md border px-2 py-2 text-sm focus-visible:ring-2 focus-visible:outline-none"
            id="countdown-insertion-deadline"
            onChange={(event) => {
              setCountdownDeadlineInput(event.target.value)
              setNotice(null)
            }}
            required
            step="1"
            type="datetime-local"
            value={countdownDeadlineInput}
          />
          <p
            className="text-muted-foreground text-[11px] leading-4"
            id="countdown-insertion-deadline-description"
          >
            Required before insertion. Expired deadlines are valid and preview the completed state.
          </p>
        </div>
      ) : null}

      {notice ? (
        <StatusMessage
          className={`rounded-lg border p-3 text-xs ${
            notice.tone === "danger"
              ? "border-destructive/25 bg-destructive/5"
              : "border-primary/20 bg-primary/5"
          }`}
          tone={notice.tone}
        >
          <p className="font-medium">{notice.title}</p>
          <p className="text-muted-foreground mt-1">{notice.detail}</p>
        </StatusMessage>
      ) : null}

      <Button
        aria-label={`Insert ${selectedEntry?.label ?? selectedType}`}
        className="w-full transition-none motion-reduce:transition-none"
        disabled={insertionDisabled}
        onClick={() => insert(selectedType)}
        size="sm"
        title={
          insertionDisabled
            ? isDocumentTransactionActive
              ? "Finish the active edit first"
              : destinationLocked
                ? "Unlock the destination Stack in Layers"
                : !countdownDeadlineReady
                  ? "Enter a valid UTC deadline"
                  : "Choose a valid insertion container"
            : `Insert ${selectedEntry?.label ?? selectedType}`
        }
        type="button"
      >
        <PlusIcon aria-hidden />
        Insert {selectedEntry?.label ?? selectedType}
      </Button>
      <p className="text-muted-foreground text-[11px] leading-4">
        Double-click a component or focus it and press Enter to insert. Component drags carry the
        same protocol type and configured Countdown deadline.
      </p>
    </section>
  )
}
