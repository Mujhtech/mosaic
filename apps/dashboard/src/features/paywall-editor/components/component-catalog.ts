import type { InsertableBlockType, ProtocolNode } from "@/features/paywall-editor/types/editor"

export const COMPONENT_LIBRARY_DRAG_TYPE = "application/x-mosaic-component-type"
export const COMPONENT_LIBRARY_COUNTDOWN_ENDS_AT_DRAG_TYPE =
  "application/x-mosaic-countdown-ends-at"

export type ComponentCategory = "Layout" | "Content" | "Controls" | "Commerce" | "Navigation"

export interface ComponentCatalogEntry {
  readonly type: InsertableBlockType
  readonly label: string
  readonly description: string
  readonly category: ComponentCategory
}

export const COMPONENT_CATEGORIES = [
  {
    label: "Layout",
    entries: [
      {
        type: "stack",
        label: "Stack",
        description: "Arrange native content vertically or horizontally.",
        category: "Layout",
      },
      {
        type: "carousel",
        label: "Carousel",
        description: "Present two or more swipeable Stack pages.",
        category: "Layout",
      },
    ],
  },
  {
    label: "Controls",
    entries: [
      {
        type: "switch",
        label: "Switch",
        description: "Let the customer control conditional paywall content.",
        category: "Controls",
      },
      {
        type: "countdown",
        label: "Countdown",
        description: "Count down to a fixed UTC deadline.",
        category: "Controls",
      },
    ],
  },
  {
    label: "Content",
    entries: [
      {
        type: "text",
        label: "Text",
        description: "Add localized heading or body copy.",
        category: "Content",
      },
      {
        type: "image",
        label: "Image",
        description: "Show an existing bundled image asset.",
        category: "Content",
      },
      {
        type: "icon",
        label: "Icon",
        description: "Add a native protocol icon to content or a Button.",
        category: "Content",
      },
      {
        type: "featureList",
        label: "Feature List",
        description: "Present a concise localized benefit list.",
        category: "Content",
      },
    ],
  },
  {
    label: "Commerce",
    entries: [
      {
        type: "productSelector",
        label: "Product Selector",
        description: "Let the customer choose an available plan.",
        category: "Commerce",
      },
      {
        type: "button",
        label: "Button",
        description: "Create a native Button and choose its action in Properties.",
        category: "Commerce",
      },
    ],
  },
] as const satisfies readonly {
  readonly label: ComponentCategory
  readonly entries: readonly ComponentCatalogEntry[]
}[]

export const COMPONENT_CATALOG = COMPONENT_CATEGORIES.flatMap<ComponentCatalogEntry>(
  (category) => category.entries,
)

export const COMPONENT_CATALOG_BY_TYPE = new Map(
  COMPONENT_CATALOG.map((entry) => [entry.type, entry]),
) as ReadonlyMap<InsertableBlockType, ComponentCatalogEntry>

export const LAYER_TYPE_LABELS = Object.freeze({
  stack: "Stack",
  carousel: "Carousel",
  switch: "Switch",
  countdown: "Countdown",
  text: "Text",
  image: "Image",
  icon: "Icon",
  featureList: "Feature List",
  productSelector: "Product Selector",
  productCard: "Product Card",
  productBadge: "Product Badge",
  button: "Button",
}) satisfies Readonly<Record<ProtocolNode["type"], string>>
