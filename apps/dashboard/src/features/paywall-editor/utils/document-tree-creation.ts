import type {
  BlockInsertionConfiguration,
  InsertableBlockType,
  MosaicDocument,
  ProtocolNode,
  Screen,
  StackComponent,
} from "@/features/paywall-editor/types/editor"
import { cloneValue } from "@/features/paywall-editor/utils/clone"
import { isValidCountdownInstant } from "@/features/paywall-editor/utils/countdown"
import {
  allocateIdentifier,
  allocateLocalizationKey,
  createUniqueProductReference,
  ensureLocalizationCatalogs,
  identifierSet,
  localizationKeySet,
  localized,
  productCardBoundsAreValid,
} from "./document-tree-dependencies"
import {
  AppendProductLayerResult,
  AppendScreenOptions,
  AppendScreenResult,
  findNode,
  updateNode,
  ZERO_INSETS,
} from "./document-tree-traversal"

export function typography(
  style: "display" | "title" | "heading" | "body" | "label" | "caption",
  alignment: "start" | "center" | "end" = "start",
) {
  const presets = {
    display: { fontSize: 40, lineHeightMultiplier: 1.1, weight: "bold" as const },
    title: { fontSize: 32, lineHeightMultiplier: 1.2, weight: "bold" as const },
    heading: { fontSize: 24, lineHeightMultiplier: 1.25, weight: "semibold" as const },
    body: { fontSize: 16, lineHeightMultiplier: 1.5, weight: "regular" as const },
    label: { fontSize: 16, lineHeightMultiplier: 1.25, weight: "semibold" as const },
    caption: { fontSize: 13, lineHeightMultiplier: 1.4, weight: "regular" as const },
  }
  return {
    style,
    ...presets[style],
    color: style === "caption" ? ("text.secondary" as const) : ("text.primary" as const),
    alignment,
  }
}

export function productCardStyles() {
  return {
    default: {
      background: { type: "color" as const, value: "surface.default" as const },
      border: { color: "border.default" as const, width: 1 },
      cornerRadius: 12,
      padding: { top: 14, start: 16, bottom: 14, end: 16 },
      opacity: 1,
    },
    selected: {
      background: { type: "color" as const, value: "surface.elevated" as const },
      border: { color: "action.primary" as const, width: 2 },
    },
  }
}

export function createProductCard(
  identifiers: Set<string>,
  keys: Set<string>,
  selectorId: string,
  productReferenceId: string,
): Extract<ProtocolNode, { type: "productCard" }> {
  const id = allocateIdentifier(identifiers, `${selectorId}-${productReferenceId}-card`)
  const nameId = allocateIdentifier(identifiers, `${id}-name`)
  const priceId = allocateIdentifier(identifiers, `${id}-price`)
  const key = `paywall.${id.replaceAll("-", "_")}`
  return {
    type: "productCard",
    id,
    productReferenceId,
    direction: "vertical",
    gap: 4,
    mainAxisDistribution: "start",
    crossAxisAlignment: "stretch",
    children: [
      {
        type: "text",
        id: nameId,
        value: localized("{{ product.name }}", allocateLocalizationKey(keys, `${key}.name`)),
        typography: typography("caption", "start"),
        accessibility: { role: "text" },
      },
      {
        type: "text",
        id: priceId,
        value: localized("{{ product.price }}", allocateLocalizationKey(keys, `${key}.price`)),
        typography: { ...typography("label", "start"), color: "text.primary" },
        accessibility: { role: "text" },
      },
    ],
    styles: productCardStyles(),
    accessibility: {
      label: localized(
        "{{ product.name }}, {{ product.price }}",
        allocateLocalizationKey(keys, `${key}.accessibility`),
      ),
    },
  }
}

export function productBadgeStyles() {
  return {
    default: {
      background: { type: "color" as const, value: "surface.elevated" as const },
      border: { color: "border.default" as const, width: 0 },
      cornerRadius: 999,
      padding: { top: 3, start: 8, bottom: 3, end: 8 },
      opacity: 1,
    },
    selected: {},
  }
}

export function appendProductCard(
  document: MosaicDocument,
  selectorId: string,
): AppendProductLayerResult | null {
  const selector = findNode(document, selectorId)
  if (selector?.type !== "productSelector" || selector.cards.length >= 20) return null
  const identifiers = identifierSet(document)
  const keys = localizationKeySet(document)
  const usedReferences = new Set(selector.cards.map((card) => card.productReferenceId))
  let products = [...document.products]
  let reference = products.find((product) => !usedReferences.has(product.id))

  if (!reference) {
    reference = createUniqueProductReference(document, identifiers, keys)
    products = [...products, reference]
  }

  const card = createProductCard(identifiers, keys, selector.id, reference.id)
  const next = updateNode({ ...document, products }, selector.id, (node) =>
    node.type === "productSelector" ? { ...node, cards: [...node.cards, card] } : node,
  )
  return { document: ensureLocalizationCatalogs(next), selectionId: card.id }
}

export function appendProductBadge(
  document: MosaicDocument,
  cardId: string,
): AppendProductLayerResult | null {
  const card = findNode(document, cardId)
  if (
    card?.type !== "productCard" ||
    card.children.some((child) => child.type === "productBadge")
  ) {
    return null
  }
  const identifiers = identifierSet(document)
  const keys = localizationKeySet(document)
  const id = allocateIdentifier(identifiers, `${card.id}-badge`)
  const textId = allocateIdentifier(identifiers, `${id}-text`)
  const badge: Extract<ProtocolNode, { type: "productBadge" }> = {
    type: "productBadge",
    id,
    placement: { mode: "nested" },
    direction: "horizontal",
    gap: 4,
    mainAxisDistribution: "center",
    crossAxisAlignment: "center",
    children: [
      {
        type: "text",
        id: textId,
        value: localized(
          "Best value",
          allocateLocalizationKey(keys, `paywall.${id.replaceAll("-", "_")}.text`),
        ),
        typography: typography("caption", "center"),
        accessibility: { role: "text" },
      },
    ],
    styles: productBadgeStyles(),
  }
  const next = ensureLocalizationCatalogs(
    updateNode(document, card.id, (node) =>
      node.type === "productCard" ? { ...node, children: [...node.children, badge] } : node,
    ),
  )
  if (!productCardBoundsAreValid(next)) return null
  return { document: next, selectionId: badge.id }
}

export function emptyStack(id: string): StackComponent {
  return {
    type: "stack",
    id,
    direction: "vertical",
    gap: 12,
    padding: { ...ZERO_INSETS },
    mainAxisDistribution: "start",
    crossAxisAlignment: "stretch",
    children: [],
  }
}

export function createBlock(
  document: MosaicDocument,
  type: InsertableBlockType,
  configuration: BlockInsertionConfiguration = {},
): ProtocolNode {
  const identifiers = identifierSet(document)
  const keys = localizationKeySet(document)
  const prefix = type.replace(/[A-Z]/g, (match) => `-${match.toLowerCase()}`)
  const id = allocateIdentifier(identifiers, prefix, true)
  const key = allocateLocalizationKey(keys, `paywall.${id.replaceAll("-", "_")}`)
  const productReferenceIds =
    document.products.length > 0
      ? document.products.map((product) => product.id)
      : ["monthly-plan", "yearly-plan"]
  const firstProduct = productReferenceIds[0] ?? "monthly-plan"

  switch (type) {
    case "stack":
      return emptyStack(id)
    case "text":
      return {
        type,
        id,
        value: localized("New text", key),
        typography: typography("body", "center"),
        sizing: { width: "fill", height: "fit" },
        accessibility: { role: "text" },
      }
    case "image":
      return {
        type,
        id,
        assetId: document.assets[0]?.id ?? "hero-image",
        sizing: { width: "fill", height: "fit" },
        aspectRatio: 1.777_777_777_8,
        contentMode: "fill",
        accessibility: { hidden: true },
      }
    case "icon":
      return {
        type,
        id,
        name: "checkmark",
        size: 20,
        color: "text.primary",
        accessibility: { hidden: true },
      }
    case "featureList":
      return {
        type,
        id,
        marker: "checkmark",
        gap: 12,
        markerColor: "action.primary",
        items: [
          {
            id: allocateIdentifier(identifiers, `${id}-item`),
            text: localized("New benefit", allocateLocalizationKey(keys, `${key}.item`)),
          },
        ],
        typography: typography("body", "start"),
        accessibility: {
          label: localized("Benefits", allocateLocalizationKey(keys, `${key}.label`)),
        },
      }
    case "productSelector": {
      const cards = productReferenceIds.map((referenceId) =>
        createProductCard(identifiers, keys, id, referenceId),
      )
      return {
        type,
        id,
        direction: "vertical",
        gap: 12,
        crossAxisAlignment: "stretch",
        initialProductCardId:
          cards.find((card) => card.productReferenceId === firstProduct)?.id ?? cards[0]!.id,
        cards,
        sizing: { width: "fill", height: "fit" },
        unavailableFallback: {
          selection: "firstAvailable",
          whenNoneAvailable: "showMessageAndDisablePurchase",
          message: localized(
            "Plans are temporarily unavailable.",
            allocateLocalizationKey(keys, `${key}.unavailable`),
          ),
        },
        accessibility: {
          label: localized("Choose a plan", allocateLocalizationKey(keys, `${key}.label`)),
        },
      }
    }
    case "button": {
      const labelId = allocateIdentifier(identifiers, `${id}-label`)
      return {
        type,
        id,
        direction: "horizontal",
        gap: 8,
        mainAxisDistribution: "center",
        crossAxisAlignment: "center",
        children: [
          {
            type: "text",
            id: labelId,
            value: localized("Button", key),
            typography: { ...typography("label", "center"), color: "action.onPrimary" },
            accessibility: { role: "text" },
          },
        ],
        appearance: {
          background: { type: "color", value: "action.primary" },
          cornerRadius: 12,
          padding: { top: 12, start: 16, bottom: 12, end: 16 },
        },
        sizing: { width: "fill", height: "fit" },
        action: { type: "close" },
        accessibility: {
          label: localized("Button", allocateLocalizationKey(keys, `${key}.accessibility`)),
        },
      }
    }
    case "carousel": {
      const pages = [0, 1].map((index) => {
        const pageNumber = index + 1
        const pageId = allocateIdentifier(identifiers, `${id}-page-${pageNumber}`)
        return {
          id: pageId,
          accessibilityLabel: localized(
            `Page ${pageNumber}`,
            allocateLocalizationKey(keys, `${key}.page_${pageNumber}.label`),
          ),
          content: emptyStack(allocateIdentifier(identifiers, `${pageId}-content`)),
        }
      })
      return {
        type,
        id,
        initialPageIndex: 0,
        showsIndicators: true,
        pages,
        sizing: { width: "fill", height: "fit" },
        accessibility: {
          label: localized("Offer highlights", allocateLocalizationKey(keys, `${key}.label`)),
        },
      }
    }
    case "switch":
      return {
        type,
        id,
        label: localized("Include this option", key),
        initialValue: false,
        typography: typography("body", "start"),
        offTrackColor: "border.default",
        onTrackColor: "action.primary",
        thumbColor: "surface.default",
        accessibility: {
          label: localized(
            "Include this option",
            allocateLocalizationKey(keys, `${key}.accessibility`),
          ),
        },
      }
    case "countdown": {
      const endsAt = configuration.countdownEndsAt
      if (!isValidCountdownInstant(endsAt)) {
        throw new Error("Countdown creation requires an explicit valid UTC deadline.")
      }
      return {
        type,
        id,
        endsAt,
        largestUnit: "day",
        smallestUnit: "second",
        completedText: localized("Offer ended", allocateLocalizationKey(keys, `${key}.completed`)),
        typography: typography("heading", "center"),
        sizing: { width: "fill", height: "fit" },
        accessibility: { role: "text" },
      }
    }
  }
}

export function appendScreen(
  document: MosaicDocument,
  options: AppendScreenOptions = {},
): AppendScreenResult {
  const identifiers = identifierSet(document)
  const keys = localizationKeySet(document)
  const ordinal = document.screens.length + 1
  const presentation = options.presentation ?? "screen"
  const sourceScreen =
    document.screens.find((candidate) => candidate.id === options.sourceScreenId) ??
    document.screens.find((candidate) => candidate.id === document.initialScreenId) ??
    document.screens[0]!
  const screenId = allocateIdentifier(identifiers, `screen-${ordinal}`)
  const layoutId = allocateIdentifier(identifiers, `${screenId}-scroll`)
  const contentId = allocateIdentifier(identifiers, `${screenId}-content`)
  const titleId = allocateIdentifier(identifiers, `${screenId}-title`)
  const linkId = allocateIdentifier(identifiers, `${screenId}-link`)
  const linkLabelId = allocateIdentifier(identifiers, `${linkId}-label`)
  const backId = allocateIdentifier(identifiers, `${screenId}-back`)
  const backLabelId = allocateIdentifier(identifiers, `${backId}-label`)
  const label = `${presentation === "sheet" ? "Sheet" : "Screen"} ${ordinal}`
  const screenLabelKey = allocateLocalizationKey(
    keys,
    `paywall.${screenId.replaceAll("-", "_")}.accessibility`,
  )
  const titleKey = allocateLocalizationKey(keys, `paywall.${screenId.replaceAll("-", "_")}.title`)
  const linkKey = allocateLocalizationKey(keys, `paywall.${screenId.replaceAll("-", "_")}.link`)
  const backKey = allocateLocalizationKey(keys, `paywall.${screenId.replaceAll("-", "_")}.back`)
  const sourceLayout = sourceScreen.layout
  const sourceContent = sourceLayout.content
  const linkLabel = `Go to ${label}`
  const navigationButton: Extract<ProtocolNode, { type: "button" }> = {
    type: "button",
    id: linkId,
    direction: "horizontal",
    gap: 8,
    mainAxisDistribution: "center",
    crossAxisAlignment: "center",
    children: [
      {
        type: "text",
        id: linkLabelId,
        value: localized(linkLabel, linkKey),
        typography: { ...typography("label", "center"), color: "action.onPrimary" },
        accessibility: { role: "text" },
      },
    ],
    appearance: {
      background: { type: "color", value: "action.primary" },
      cornerRadius: 12,
      padding: { top: 12, start: 16, bottom: 12, end: 16 },
    },
    sizing: { width: "fill", height: "fit" },
    action: { type: "navigateTo", screenId },
    accessibility: { label: localized(linkLabel, linkKey) },
  }
  const existingScreens = document.screens.map((existingScreen, index) => {
    const accessibilityLabel =
      existingScreen.accessibilityLabel ??
      localized(
        `Screen ${index + 1}`,
        allocateLocalizationKey(
          keys,
          `paywall.${existingScreen.id.replaceAll("-", "_")}.accessibility`,
        ),
      )
    if (existingScreen.id === sourceScreen.id) {
      return {
        ...existingScreen,
        accessibilityLabel,
        layout: {
          ...existingScreen.layout,
          content: {
            ...existingScreen.layout.content,
            children: [...existingScreen.layout.content.children, navigationButton],
          },
        },
      }
    }
    if (existingScreen.accessibilityLabel) return existingScreen
    const existingLabel = `Screen ${index + 1}`
    return {
      ...existingScreen,
      accessibilityLabel: { ...accessibilityLabel, default: existingLabel },
    }
  })
  const screen = {
    id: screenId,
    presentation: { type: presentation },
    accessibilityLabel: localized(label, screenLabelKey),
    layout: {
      ...cloneValue(sourceLayout),
      id: layoutId,
      content: {
        ...emptyStack(contentId),
        gap: sourceContent.gap,
        padding: cloneValue(sourceContent.padding),
        mainAxisDistribution: sourceContent.mainAxisDistribution,
        crossAxisAlignment: sourceContent.crossAxisAlignment,
        children: [
          {
            type: "button",
            id: backId,
            direction: "horizontal",
            gap: 8,
            mainAxisDistribution: "start",
            crossAxisAlignment: "center",
            children: [
              {
                type: "text",
                id: backLabelId,
                value: localized("Back", backKey),
                typography: typography("label", "start"),
                accessibility: { role: "text" },
              },
            ],
            action: { type: "navigateBack" },
            accessibility: { label: localized("Back", backKey) },
          },
          {
            type: "text",
            id: titleId,
            value: localized(label, titleKey),
            typography: typography("title", "center"),
            sizing: { width: "fill", height: "fit" },
            accessibility: { role: "heading", level: 1 },
          },
        ],
      },
    },
  } as Screen
  const nextDocument = ensureLocalizationCatalogs({
    ...document,
    screens: [...existingScreens, screen],
  })
  return { document: nextDocument, screenId, selectionId: titleId }
}
