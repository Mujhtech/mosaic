import AVFoundation
import SwiftUI

#if os(iOS)
  import UIKit
#elseif os(macOS)
  import AppKit
#endif

public struct MosaicImageResolver: @unchecked Sendable {
  private let resolver: @MainActor (String) -> Image?

  public init(_ resolver: @escaping @MainActor (String) -> Image?) {
    self.resolver = resolver
  }

  @MainActor public func image(for key: String) -> Image? { resolver(key) }

  public static let missing = MosaicImageResolver { _ in nil }
}

public struct MosaicVideoResolver: @unchecked Sendable {
  private let resolver: @MainActor (String) -> URL?

  public init(_ resolver: @escaping @MainActor (String) -> URL?) {
    self.resolver = resolver
  }

  @MainActor public func url(for key: String) -> URL? { resolver(key) }
  public static let missing = MosaicVideoResolver { _ in nil }
}

/// Native SwiftUI renderer for validated Mosaic Protocol 0.2 documents.
/// The host application retains ownership of sheet or full-screen dismissal.
@MainActor
public struct MosaicPaywall: View {
  @StateObject private var model: MosaicPaywallModel
  private let imageResolver: MosaicImageResolver
  private let videoResolver: MosaicVideoResolver

  public init(
    document: MosaicPaywallDocument,
    requestedLocale: String? = nil,
    purchaseProvider: any MosaicPurchaseProvider,
    imageResolver: MosaicImageResolver = .missing,
    videoResolver: MosaicVideoResolver = .missing,
    clock: @escaping @Sendable () -> Date = { Date() },
    onInteraction: @escaping @MainActor (MosaicInteractionOutcome) -> Void = { _ in },
    onResult: @escaping @MainActor (MosaicPresentationResult) -> Void
  ) {
    _model = StateObject(
      wrappedValue: MosaicPaywallModel(
        document: document,
        requestedLocale: requestedLocale,
        purchaseProvider: purchaseProvider,
        clock: clock,
        onInteraction: onInteraction,
        onResult: onResult
      )
    )
    self.imageResolver = imageResolver
    self.videoResolver = videoResolver
  }

  public init(
    model: @autoclosure @escaping () -> MosaicPaywallModel,
    imageResolver: MosaicImageResolver = .missing,
    videoResolver: MosaicVideoResolver = .missing
  ) {
    _model = StateObject(wrappedValue: model())
    self.imageResolver = imageResolver
    self.videoResolver = videoResolver
  }

  public var body: some View {
    surface(for: model.baseScreen)
      .sheet(item: presentedSheet) { _ in
        if let sheet = model.presentedSheet {
          surface(for: sheet)
            .mosaicScreenAccessibilityLabel(
              sheet.accessibilityLabel.map(model.localization.resolve))
        }
      }
      .environment(\.mosaicDocument, model.document)
      .environment(\.mosaicImageResolver, imageResolver)
      .environment(\.mosaicVideoResolver, videoResolver)
      .environmentObject(model)
      .environment(\.layoutDirection, swiftUILayoutDirection)
      .environment(\.locale, Locale(identifier: model.localization.resolvedLocale.effectiveLocale))
      .task { await model.prepare() }
  }

  private var presentedSheet: Binding<MosaicScreen?> {
    Binding(
      get: { model.presentedSheet },
      set: { if $0 == nil { model.dismissPresentedSheet() } }
    )
  }

  private func surface(for screen: MosaicScreen?) -> some View {
    let layout = screen?.layout ?? model.document.layout
    return ScrollView(.vertical, showsIndicators: layout.showsIndicators) {
      MosaicStackView(
        stack: layout.content,
        document: model.document,
        localization: model.localization,
        model: model,
        imageResolver: imageResolver,
        productOption: nil
      )
    }
    .background {
      if let background = layout.background {
        MosaicBackgroundView(background: background)
      }
    }
    .environment(\.mosaicAxisBounds, MosaicAxisBounds(width: true, height: false))
    .mosaicScreenAccessibilityLabel(
      screen?.accessibilityLabel.map(model.localization.resolve)
    )
  }

  private var swiftUILayoutDirection: LayoutDirection {
    model.localization.resolvedLocale.direction == .rightToLeft ? .rightToLeft : .leftToRight
  }
}

@MainActor
private struct MosaicStackView: View {
  @Environment(\.mosaicAxisBounds) private var parentBounds
  let stack: MosaicStack
  let document: MosaicPaywallDocument
  let localization: MosaicLocalizationResolver
  @ObservedObject var model: MosaicPaywallModel
  let imageResolver: MosaicImageResolver
  let productOption: MosaicResolvedProductOption?

  @ViewBuilder
  var body: some View {
    if model.isVisible(stack.visibility) {
      stackContent
        .environment(\.mosaicAxisBounds, childBounds)
        .frame(maxWidth: stackFrameMaximumWidth, alignment: stackFrameAlignment)
        .padding(.top, stack.padding.top)
        .padding(.leading, stack.padding.start)
        .padding(.bottom, stack.padding.bottom)
        .padding(.trailing, stack.padding.end)
        .mosaicPresentation(
          appearance: stack.appearance,
          sizing: stack.sizing,
          outerInsets: stack.outerInsets
        )
    }
  }

  @ViewBuilder
  private var stackContent: some View {
    switch stack.direction {
    case .vertical:
      VStack(alignment: verticalAlignment, spacing: stack.gap) {
        leadingMainAxisSpacer
        ForEach(Array(stack.children.enumerated()), id: \.element.id) { index, node in
          nodeView(node)
            .mosaicStretchWidth(stack.crossAxisAlignment == .stretch)
          if stack.mainAxisDistribution == .spaceBetween,
            index < stack.children.count - 1
          {
            Spacer(minLength: stack.gap)
          }
        }
        trailingMainAxisSpacer
      }
    case .horizontal:
      HStack(alignment: horizontalAlignment, spacing: stack.gap) {
        leadingMainAxisSpacer
        ForEach(Array(stack.children.enumerated()), id: \.element.id) { index, node in
          nodeView(node)
          if stack.mainAxisDistribution == .spaceBetween,
            index < stack.children.count - 1
          {
            Spacer(minLength: stack.gap)
          }
        }
        trailingMainAxisSpacer
      }
    }
  }

  private func nodeView(_ node: MosaicNode) -> some View {
    MosaicNodeView(
      node: node,
      document: document,
      localization: localization,
      model: model,
      imageResolver: imageResolver,
      productOption: productOption
    )
    .id(node.id)
  }

  @ViewBuilder
  private var leadingMainAxisSpacer: some View {
    if stack.mainAxisDistribution == .center || stack.mainAxisDistribution == .end {
      Spacer(minLength: 0)
    }
  }

  @ViewBuilder
  private var trailingMainAxisSpacer: some View {
    if stack.mainAxisDistribution == .center {
      Spacer(minLength: 0)
    }
  }

  private var verticalAlignment: HorizontalAlignment {
    switch stack.crossAxisAlignment {
    case .start, .stretch: .leading
    case .center: .center
    case .end: .trailing
    }
  }

  private var horizontalAlignment: VerticalAlignment {
    switch stack.crossAxisAlignment {
    case .start, .stretch: .top
    case .center: .center
    case .end: .bottom
    }
  }

  private var stackFrameMaximumWidth: CGFloat? {
    switch stack.direction {
    case .vertical:
      stack.crossAxisAlignment == .stretch ? .infinity : nil
    case .horizontal:
      stack.mainAxisDistribution == .start ? nil : .infinity
    }
  }

  private var stackFrameAlignment: Alignment {
    switch stack.crossAxisAlignment {
    case .start, .stretch: .leading
    case .center: .center
    case .end: .trailing
    }
  }

  private var childBounds: MosaicAxisBounds {
    parentBounds
      .constrained(by: stack.sizing)
      .forStackChildren(direction: stack.direction)
  }
}

@MainActor
private struct MosaicNodeView: View {
  let node: MosaicNode
  let document: MosaicPaywallDocument
  let localization: MosaicLocalizationResolver
  @ObservedObject var model: MosaicPaywallModel
  let imageResolver: MosaicImageResolver
  let productOption: MosaicResolvedProductOption?

  @ViewBuilder
  var body: some View {
    if model.isVisible(node.visibility) {
      switch node {
      case .verticalStack(let stack), .stack(let stack):
        MosaicStackView(
          stack: stack,
          document: document,
          localization: localization,
          model: model,
          imageResolver: imageResolver,
          productOption: productOption
        )
      case .text(let component):
        MosaicTextView(
          component: component,
          localization: localization,
          productOption: productOption
        )
      case .image(let component):
        MosaicImageView(
          component: component,
          asset: document.assets.first { $0.id == component.assetId },
          localization: localization,
          resolver: imageResolver
        )
      case .icon(let component):
        MosaicIconView(component: component, localization: localization)
      case .featureList(let component):
        MosaicFeatureListView(component: component, localization: localization)
      case .productSelector(let component):
        MosaicProductSelectorView(
          component: component,
          document: document,
          localization: localization,
          model: model,
          imageResolver: imageResolver
        )
      case .button(let component):
        MosaicButtonView(
          component: component,
          document: document,
          localization: localization,
          model: model,
          imageResolver: imageResolver
        )
      case .purchaseButton(let component):
        MosaicPurchaseButtonView(component: component, localization: localization, model: model)
      case .restoreButton(let component):
        MosaicRestoreButtonView(component: component, localization: localization, model: model)
      case .closeButton(let component):
        MosaicCloseButtonView(component: component, localization: localization, model: model)
      case .legalText(let component):
        MosaicLegalTextView(component: component, localization: localization)
      case .carousel(let component):
        MosaicCarouselView(
          component: component,
          document: document,
          localization: localization,
          model: model,
          imageResolver: imageResolver
        )
      case .switchControl(let component):
        MosaicSwitchView(component: component, localization: localization, model: model)
      case .countdown(let component):
        MosaicCountdownView(component: component, localization: localization, model: model)
      }
    }
  }
}

private struct MosaicStyledText: View {
  @Environment(\.mosaicDocument) private var document
  let value: String
  let typography: MosaicTypography

  var body: some View {
    Text(value)
      .font(.system(size: typography.fontSize, weight: typography.weight.swiftUI))
      .foregroundStyle(typography.color.swiftUI(in: document))
      .lineSpacing(max(0, typography.fontSize * (typography.lineHeightMultiplier - 1)))
      .multilineTextAlignment(typography.alignment.swiftUI)
      .lineLimit(typography.maxLines)
      .truncationMode(.tail)
      .frame(maxWidth: .infinity, alignment: typography.alignment.frameAlignment)
      .fixedSize(horizontal: false, vertical: typography.maxLines == nil)
      .mosaicClipText(typography.overflow == .clip)
  }
}

private struct MosaicTextView: View {
  let component: MosaicTextComponent
  let localization: MosaicLocalizationResolver
  let productOption: MosaicResolvedProductOption?

  var body: some View {
    MosaicStyledText(
      value: productOption.map { localization.resolve(component.value, for: $0) }
        ?? localization.resolve(component.value),
      typography: component.typography
    )
    .mosaicHeading(component.accessibility)
    .mosaicTextAccessibilityLabel(component.accessibility, localization: localization)
    .mosaicPresentation(
      appearance: component.appearance,
      sizing: component.sizing,
      outerInsets: component.outerInsets
    )
  }
}

@MainActor
private struct MosaicImageView: View {
  let component: MosaicImageComponent
  let asset: MosaicImageAsset?
  let localization: MosaicLocalizationResolver
  let resolver: MosaicImageResolver

  var body: some View {
    imageContent
      .mosaicImageDimensions(component)
      .clipped()
      .mosaicImageAccessibility(component.accessibility, localization: localization)
      .mosaicPresentation(
        appearance: component.appearance,
        sizing: component.sizing,
        outerInsets: component.outerInsets
      )
  }

  @ViewBuilder
  private var imageContent: some View {
    if let asset {
      switch asset.source {
      case .bundled(let key):
        if let image = resolver.image(for: key) {
          image.resizable().mosaicMediaContentMode(component.contentMode)
        } else {
          imageFallback(asset)
        }
      case .remote(let url):
        AsyncImage(url: url) { phase in
          switch phase {
          case .success(let image): image.resizable().mosaicMediaContentMode(component.contentMode)
          case .empty: imageFallback(asset)
          case .failure: imageFallback(asset)
          @unknown default: imageFallback(asset)
          }
        }
      }
    } else {
      imageFallback(nil)
    }
  }

  private func imageFallback(_ asset: MosaicAsset?) -> some View {
    ZStack {
      Color.secondary.opacity(0.12)
      Text(asset?.fallback.map { localization.resolve($0.value) } ?? "")
        .font(.body)
        .foregroundStyle(.secondary)
        .multilineTextAlignment(.center)
        .padding()
    }
  }
}

private struct MosaicIconView: View {
  @Environment(\.mosaicDocument) private var document
  let component: MosaicIconComponent
  let localization: MosaicLocalizationResolver

  var body: some View {
    Image(systemName: component.name.systemName)
      .font(.system(size: component.size, weight: .regular))
      .foregroundStyle(component.color.swiftUI(in: document))
      .mosaicImageAccessibility(component.accessibility, localization: localization)
      .mosaicPresentation(
        appearance: component.appearance,
        sizing: component.sizing,
        outerInsets: component.outerInsets
      )
  }
}

private struct MosaicFeatureListView: View {
  @Environment(\.mosaicDocument) private var document
  let component: MosaicFeatureListComponent
  let localization: MosaicLocalizationResolver

  var body: some View {
    VStack(alignment: .leading, spacing: component.gap) {
      ForEach(component.items) { item in
        HStack(alignment: .firstTextBaseline, spacing: 10) {
          Image(systemName: "checkmark")
            .foregroundStyle(component.markerColor.swiftUI(in: document))
            .accessibilityHidden(true)
          MosaicStyledText(
            value: localization.resolve(item.text), typography: component.typography
          )
        }
        .accessibilityElement(children: .combine)
      }
    }
    .frame(maxWidth: .infinity, alignment: .leading)
    .accessibilityElement(children: .contain)
    .accessibilityLabel(Text(localization.resolve(component.accessibility.label)))
    .mosaicAccessibilityHint(component.accessibility.hint.map(localization.resolve))
    .mosaicPresentation(
      appearance: component.appearance,
      sizing: component.sizing,
      outerInsets: component.outerInsets
    )
  }
}

@MainActor
private struct MosaicProductSelectorView: View {
  @Environment(\.mosaicAxisBounds) private var parentBounds
  let component: MosaicProductSelectorComponent
  let document: MosaicPaywallDocument
  let localization: MosaicLocalizationResolver
  @ObservedObject var model: MosaicPaywallModel
  let imageResolver: MosaicImageResolver

  @ViewBuilder
  var body: some View {
    selectorContent
      .environment(\.mosaicAxisBounds, childBounds)
      .frame(maxWidth: .infinity, alignment: .leading)
      .accessibilityElement(children: .contain)
      .accessibilityLabel(Text(localization.resolve(component.accessibility.label)))
      .mosaicAccessibilityHint(component.accessibility.hint.map(localization.resolve))
      .mosaicPresentation(
        appearance: component.appearance,
        sizing: component.sizing,
        outerInsets: component.outerInsets
      )
  }

  @ViewBuilder
  private var selectorContent: some View {
    let options = model.availableOptions(for: component)
    if options.isEmpty {
      Text(localization.resolve(component.unavailableFallback.message))
        .foregroundColor(.secondary)
        .frame(maxWidth: .infinity, alignment: .leading)
        .fixedSize(horizontal: false, vertical: true)
    } else if component.direction == .horizontal {
      HStack(alignment: horizontalCrossAxisAlignment, spacing: component.gap) {
        optionViews(options)
      }
    } else {
      VStack(alignment: verticalCrossAxisAlignment, spacing: component.gap) {
        optionViews(options)
      }
    }
  }

  @ViewBuilder
  private func optionViews(_ options: [MosaicResolvedProductOption]) -> some View {
    ForEach(options) { option in
      if let card = option.card {
        let selected = model.selectedProductCardID(for: component.id) == card.id
        MosaicAuthoredProductCardView(
          card: card,
          option: option,
          selected: selected,
          document: document,
          localization: localization,
          model: model,
          imageResolver: imageResolver,
          onSelect: { model.selectProduct(cardID: card.id, in: component.id) }
        )
        .frame(
          maxWidth: maximumWidth(for: card),
          maxHeight: maximumHeight(for: card),
          alignment: optionFrameAlignment
        )
      } else {
        let selected = model.selectedProductReferenceID(for: component.id) == option.reference.id
        MosaicLegacyProductCardView(
          option: option,
          selected: selected,
          style: selected
            ? component.cardStyles.selected.resolving(component.cardStyles.defaultStyle)
            : component.cardStyles.defaultStyle,
          localization: localization,
          onSelect: { model.selectProduct(referenceID: option.reference.id, in: component.id) }
        )
        .frame(
          maxWidth: optionMaximumWidth,
          maxHeight: optionMaximumHeight,
          alignment: optionFrameAlignment
        )
      }
    }
  }

  private var verticalCrossAxisAlignment: HorizontalAlignment {
    switch component.crossAxisAlignment {
    case .start, .stretch: .leading
    case .center: .center
    case .end: .trailing
    }
  }

  private var horizontalCrossAxisAlignment: VerticalAlignment {
    switch component.crossAxisAlignment {
    case .start, .stretch: .top
    case .center: .center
    case .end: .bottom
    }
  }

  private var optionMaximumWidth: CGFloat? {
    component.direction == .horizontal || component.crossAxisAlignment == .stretch
      ? .infinity : nil
  }

  private var optionMaximumHeight: CGFloat? {
    component.direction == .horizontal && component.crossAxisAlignment == .stretch
      ? .infinity : nil
  }

  private func maximumWidth(for card: MosaicProductCardComponent) -> CGFloat? {
    switch card.sizing?.width {
    case .fixed?, .fit?, .content?: nil
    case .fill?, .none: optionMaximumWidth
    }
  }

  private func maximumHeight(for card: MosaicProductCardComponent) -> CGFloat? {
    switch card.sizing?.height {
    case .fixed?, .fit?, .content?: nil
    case .fill?, .none: optionMaximumHeight
    }
  }

  private var optionFrameAlignment: Alignment {
    switch component.crossAxisAlignment {
    case .start, .stretch: .leading
    case .center: .center
    case .end: .trailing
    }
  }

  private var childBounds: MosaicAxisBounds {
    parentBounds
      .constrained(by: component.sizing)
      .forStackChildren(direction: component.direction)
  }
}

@MainActor
private struct MosaicAuthoredProductCardView: View {
  @Environment(\.mosaicDocument) private var environmentDocument
  @Environment(\.mosaicAxisBounds) private var parentBounds
  let card: MosaicProductCardComponent
  let option: MosaicResolvedProductOption
  let selected: Bool
  let document: MosaicPaywallDocument
  let localization: MosaicLocalizationResolver
  @ObservedObject var model: MosaicPaywallModel
  let imageResolver: MosaicImageResolver
  let onSelect: () -> Void

  private var style: MosaicAuthoredProductBoxStyle {
    card.styles.resolving(selected: selected)
  }

  private var overlayBadge: MosaicProductBadgeComponent? {
    card.children.compactMap { child -> MosaicProductBadgeComponent? in
      guard case .badge(let badge) = child,
        case .overlay = badge.placement
      else { return nil }
      return badge
    }.first
  }

  var body: some View {
    Button(action: onSelect) {
      MosaicProductCardContentView(
        card: card,
        option: option,
        selected: selected,
        document: document,
        localization: localization,
        model: model,
        imageResolver: imageResolver
      )
      .padding(.top, style.padding.top)
      .padding(.leading, style.padding.start)
      .padding(.bottom, style.padding.bottom)
      .padding(.trailing, style.padding.end)
      .frame(
        maxWidth: cardUsesAvailableWidth ? .infinity : nil,
        alignment: cardFrameAlignment
      )
      .overlay(alignment: overlayAlignment) {
        if let overlayBadge {
          MosaicProductBadgeView(
            badge: overlayBadge,
            option: option,
            selected: selected,
            document: document,
            localization: localization,
            model: model,
            imageResolver: imageResolver
          )
          .environment(\.mosaicAxisBounds, parentBounds.constrained(by: card.sizing))
          .padding(overlayPaddingEdges, overlayInset)
        }
      }
      .contentShape(Rectangle())
    }
    .buttonStyle(.plain)
    .background {
      RoundedRectangle(cornerRadius: style.cornerRadius, style: .continuous)
        .fill(Color.clear)
        .background {
          MosaicBackgroundView(background: style.background)
            .clipShape(RoundedRectangle(cornerRadius: style.cornerRadius, style: .continuous))
        }
    }
    .overlay {
      RoundedRectangle(cornerRadius: style.cornerRadius, style: .continuous)
        .strokeBorder(
          style.border.color.swiftUI(in: environmentDocument),
          lineWidth: style.border.width)
    }
    .opacity(style.opacity)
    .mosaicShadow(style.shadow)
    .mosaicSizing(card.sizing)
    .frame(minWidth: 44, minHeight: 44)
    .accessibilityElement(children: .ignore)
    .accessibilityLabel(Text(model.productCardAccessibilityLabel(card, option: option)))
    .mosaicSelected(selected)
  }

  private var cardFrameAlignment: Alignment {
    switch card.crossAxisAlignment {
    case .start, .stretch: .leading
    case .center: .center
    case .end: .trailing
    }
  }

  private var cardUsesAvailableWidth: Bool {
    if case .fill? = card.sizing?.width { return true }
    return false
  }

  private var overlayAlignment: Alignment {
    guard let overlayBadge,
      case .overlay(let anchor, _) = overlayBadge.placement
    else { return .center }
    switch anchor {
    case .topStart: return Alignment.topLeading
    case .topEnd: return Alignment.topTrailing
    case .bottomStart: return Alignment.bottomLeading
    case .bottomEnd: return Alignment.bottomTrailing
    }
  }

  private var overlayInset: Double {
    guard let overlayBadge,
      case .overlay(_, let inset) = overlayBadge.placement
    else { return 0 }
    return inset
  }

  private var overlayPaddingEdges: Edge.Set {
    guard let overlayBadge,
      case .overlay(let anchor, _) = overlayBadge.placement
    else { return [] }
    switch anchor {
    case .topStart: return Edge.Set([.top, .leading])
    case .topEnd: return Edge.Set([.top, .trailing])
    case .bottomStart: return Edge.Set([.bottom, .leading])
    case .bottomEnd: return Edge.Set([.bottom, .trailing])
    }
  }
}

@MainActor
private struct MosaicProductCardContentView: View {
  @Environment(\.mosaicAxisBounds) private var parentBounds
  let card: MosaicProductCardComponent
  let option: MosaicResolvedProductOption
  let selected: Bool
  let document: MosaicPaywallDocument
  let localization: MosaicLocalizationResolver
  @ObservedObject var model: MosaicPaywallModel
  let imageResolver: MosaicImageResolver

  private var layoutChildren: [MosaicProductCardChild] {
    card.children.filter { child in
      guard case .badge(let badge) = child,
        case .overlay = badge.placement
      else { return true }
      return false
    }
  }

  @ViewBuilder
  var body: some View {
    content.environment(\.mosaicAxisBounds, childBounds)
  }

  @ViewBuilder
  private var content: some View {
    switch card.direction {
    case .vertical:
      VStack(alignment: verticalAlignment, spacing: card.gap) {
        leadingMainAxisSpacer
        childViews
        trailingMainAxisSpacer
      }
    case .horizontal:
      HStack(alignment: horizontalAlignment, spacing: card.gap) {
        leadingMainAxisSpacer
        childViews
        trailingMainAxisSpacer
      }
    }
  }

  private var childBounds: MosaicAxisBounds {
    parentBounds
      .constrained(by: card.sizing)
      .forStackChildren(direction: card.direction)
  }

  @ViewBuilder
  private var childViews: some View {
    ForEach(Array(layoutChildren.enumerated()), id: \.element.id) { index, child in
      MosaicProductCardChildView(
        child: child,
        option: option,
        selected: selected,
        document: document,
        localization: localization,
        model: model,
        imageResolver: imageResolver
      )
      .mosaicStretchWidth(card.direction == .vertical && card.crossAxisAlignment == .stretch)
      if card.mainAxisDistribution == .spaceBetween,
        index < layoutChildren.count - 1
      {
        Spacer(minLength: card.gap)
      }
    }
  }

  @ViewBuilder
  private var leadingMainAxisSpacer: some View {
    if card.mainAxisDistribution == .center || card.mainAxisDistribution == .end {
      Spacer(minLength: 0)
    }
  }

  @ViewBuilder
  private var trailingMainAxisSpacer: some View {
    if card.mainAxisDistribution == .center { Spacer(minLength: 0) }
  }

  private var verticalAlignment: HorizontalAlignment {
    switch card.crossAxisAlignment {
    case .start, .stretch: .leading
    case .center: .center
    case .end: .trailing
    }
  }

  private var horizontalAlignment: VerticalAlignment {
    switch card.crossAxisAlignment {
    case .start, .stretch: .top
    case .center: .center
    case .end: .bottom
    }
  }
}

@MainActor
private struct MosaicProductCardChildView: View {
  let child: MosaicProductCardChild
  let option: MosaicResolvedProductOption
  let selected: Bool
  let document: MosaicPaywallDocument
  let localization: MosaicLocalizationResolver
  @ObservedObject var model: MosaicPaywallModel
  let imageResolver: MosaicImageResolver

  @ViewBuilder
  var body: some View {
    switch child {
    case .node(let node):
      MosaicNodeView(
        node: node,
        document: document,
        localization: localization,
        model: model,
        imageResolver: imageResolver,
        productOption: option
      )
    case .badge(let badge):
      if case .nested = badge.placement {
        MosaicProductBadgeView(
          badge: badge,
          option: option,
          selected: selected,
          document: document,
          localization: localization,
          model: model,
          imageResolver: imageResolver
        )
      }
    }
  }
}

@MainActor
private struct MosaicProductBadgeView: View {
  @Environment(\.mosaicDocument) private var environmentDocument
  @Environment(\.mosaicAxisBounds) private var parentBounds
  let badge: MosaicProductBadgeComponent
  let option: MosaicResolvedProductOption
  let selected: Bool
  let document: MosaicPaywallDocument
  let localization: MosaicLocalizationResolver
  @ObservedObject var model: MosaicPaywallModel
  let imageResolver: MosaicImageResolver

  private var style: MosaicAuthoredProductBoxStyle {
    badge.styles.resolving(selected: selected)
  }

  var body: some View {
    badgeContent
      .environment(\.mosaicAxisBounds, childBounds)
      .padding(.top, style.padding.top)
      .padding(.leading, style.padding.start)
      .padding(.bottom, style.padding.bottom)
      .padding(.trailing, style.padding.end)
      .background {
        RoundedRectangle(cornerRadius: style.cornerRadius, style: .continuous)
          .fill(Color.clear)
          .background {
            MosaicBackgroundView(background: style.background)
              .clipShape(RoundedRectangle(cornerRadius: style.cornerRadius, style: .continuous))
          }
      }
      .overlay {
        RoundedRectangle(cornerRadius: style.cornerRadius, style: .continuous)
          .strokeBorder(
            style.border.color.swiftUI(in: environmentDocument),
            lineWidth: style.border.width)
      }
      .opacity(style.opacity)
      .mosaicShadow(style.shadow)
      .mosaicSizing(badge.sizing)
  }

  @ViewBuilder
  private var badgeContent: some View {
    switch badge.direction {
    case .vertical:
      VStack(alignment: verticalAlignment, spacing: badge.gap) {
        leadingMainAxisSpacer
        childViews
        trailingMainAxisSpacer
      }
    case .horizontal:
      HStack(alignment: horizontalAlignment, spacing: badge.gap) {
        leadingMainAxisSpacer
        childViews
        trailingMainAxisSpacer
      }
    }
  }

  @ViewBuilder
  private var childViews: some View {
    ForEach(Array(badge.children.enumerated()), id: \.element.id) { index, node in
      MosaicNodeView(
        node: node,
        document: document,
        localization: localization,
        model: model,
        imageResolver: imageResolver,
        productOption: option
      )
      .mosaicStretchWidth(badge.direction == .vertical && badge.crossAxisAlignment == .stretch)
      if badge.mainAxisDistribution == .spaceBetween,
        index < badge.children.count - 1
      {
        Spacer(minLength: badge.gap)
      }
    }
  }

  @ViewBuilder
  private var leadingMainAxisSpacer: some View {
    if badge.mainAxisDistribution == .center || badge.mainAxisDistribution == .end {
      Spacer(minLength: 0)
    }
  }

  @ViewBuilder
  private var trailingMainAxisSpacer: some View {
    if badge.mainAxisDistribution == .center { Spacer(minLength: 0) }
  }

  private var verticalAlignment: HorizontalAlignment {
    switch badge.crossAxisAlignment {
    case .start, .stretch: .leading
    case .center: .center
    case .end: .trailing
    }
  }

  private var horizontalAlignment: VerticalAlignment {
    switch badge.crossAxisAlignment {
    case .start, .stretch: .top
    case .center: .center
    case .end: .bottom
    }
  }

  private var childBounds: MosaicAxisBounds {
    parentBounds
      .constrained(by: badge.sizing)
      .forStackChildren(direction: badge.direction)
  }
}

private struct MosaicLegacyProductCardView: View {
  let option: MosaicResolvedProductOption
  let selected: Bool
  let style: MosaicProductCardStyle
  let localization: MosaicLocalizationResolver
  let onSelect: () -> Void

  var body: some View {
    Button(action: onSelect) {
      cardContent
        .padding(.top, style.padding.top)
        .padding(.leading, style.padding.start)
        .padding(.bottom, style.padding.bottom)
        .padding(.trailing, style.padding.end)
        .frame(maxWidth: .infinity, alignment: cardAlignment)
        .contentShape(Rectangle())
    }
    .buttonStyle(.plain)
    .background(
      RoundedRectangle(cornerRadius: style.cornerRadius, style: .continuous)
        .fill(style.background.swiftUI)
    )
    .overlay {
      RoundedRectangle(cornerRadius: style.cornerRadius, style: .continuous)
        .stroke(style.border.color.swiftUI, lineWidth: style.border.width)
    }
    .accessibilityElement(children: .ignore)
    .accessibilityLabel(Text(localization.resolve(option.reference.label)))
    .accessibilityValue(Text(accessibilityValue))
    .mosaicSelected(selected)
  }

  @ViewBuilder
  private var cardContent: some View {
    if style.contentAlignment == .spaceBetween {
      HStack(alignment: .center, spacing: style.contentGap) {
        labelContent
        Spacer(minLength: style.contentGap)
        price
      }
    } else {
      VStack(alignment: stackAlignment, spacing: style.contentGap) {
        labelContent
        price
      }
    }
  }

  private var labelContent: some View {
    VStack(alignment: stackAlignment, spacing: 4) {
      Text(localization.resolve(option.reference.label))
        .font(.headline)
        .foregroundColor(style.productLabelColor.swiftUI)
      if let badge = option.reference.badge {
        Text(localization.resolve(badge))
          .font(.caption.bold())
          .foregroundColor(style.badge.textColor.swiftUI)
          .padding(.top, style.badge.padding.top)
          .padding(.leading, style.badge.padding.start)
          .padding(.bottom, style.badge.padding.bottom)
          .padding(.trailing, style.badge.padding.end)
          .background(
            RoundedRectangle(cornerRadius: style.badge.cornerRadius, style: .continuous)
              .fill(style.badge.background.swiftUI)
          )
          .overlay {
            RoundedRectangle(cornerRadius: style.badge.cornerRadius, style: .continuous)
              .stroke(style.badge.border.color.swiftUI, lineWidth: style.badge.border.width)
          }
      }
      if let period = option.product.localizedSubscriptionPeriod {
        Text(period)
          .font(.caption)
          .foregroundColor(style.runtimePriceColor.swiftUI.opacity(0.82))
      }
    }
  }

  private var price: some View {
    Text(option.product.localizedPrice)
      .font(.headline.monospacedDigit())
      .foregroundColor(style.runtimePriceColor.swiftUI)
  }

  private var stackAlignment: HorizontalAlignment {
    switch style.contentAlignment {
    case .start, .spaceBetween: .leading
    case .center: .center
    case .end: .trailing
    }
  }

  private var cardAlignment: Alignment {
    switch style.contentAlignment {
    case .start, .spaceBetween: .leading
    case .center: .center
    case .end: .trailing
    }
  }

  private var accessibilityValue: String {
    [
      option.reference.badge.map(localization.resolve),
      option.product.localizedPrice,
      option.product.localizedSubscriptionPeriod,
    ].compactMap { $0 }.joined(separator: ", ")
  }
}

@MainActor
private struct MosaicButtonView: View {
  @Environment(\.openURL) private var openURL

  let component: MosaicButtonComponent
  let document: MosaicPaywallDocument
  let localization: MosaicLocalizationResolver
  @ObservedObject var model: MosaicPaywallModel
  let imageResolver: MosaicImageResolver

  var body: some View {
    let busy = model.isButtonBusy(component.id)
    Button(action: handleAction) {
      MosaicButtonContentView(
        component: component,
        children: component.content(isInProgress: busy),
        document: document,
        localization: localization,
        model: model,
        imageResolver: imageResolver
      )
    }
    .buttonStyle(.plain)
    .disabled(!model.isButtonEnabled(component))
    .accessibilityElement(children: .ignore)
    .accessibilityLabel(Text(localization.resolve(component.accessibility.label)))
    .mosaicAccessibilityHint(component.accessibility.hint.map(localization.resolve))
    .mosaicPresentation(
      appearance: component.appearance,
      sizing: component.sizing,
      outerInsets: component.outerInsets
    )
    .frame(minWidth: 44, minHeight: 44)
  }

  private func handleAction() {
    switch component.action {
    case .purchase:
      Task { await model.purchase(using: component) }
    case .restore:
      Task { await model.restore(using: component) }
    case .close, .navigateTo, .navigateBack:
      model.performSynchronousAction(using: component)
    case .openExternalURL(let url):
      openURL(url) { accepted in
        model.recordExternalURLOpenResult(accepted)
      }
    }
  }
}

@MainActor
private struct MosaicButtonContentView: View {
  @Environment(\.mosaicAxisBounds) private var parentBounds
  let component: MosaicButtonComponent
  let children: [MosaicNode]
  let document: MosaicPaywallDocument
  let localization: MosaicLocalizationResolver
  @ObservedObject var model: MosaicPaywallModel
  let imageResolver: MosaicImageResolver

  @ViewBuilder
  var body: some View {
    content.environment(\.mosaicAxisBounds, childBounds)
  }

  @ViewBuilder
  private var content: some View {
    switch component.direction {
    case .vertical:
      VStack(alignment: verticalAlignment, spacing: component.gap) {
        leadingMainAxisSpacer
        childViews
        trailingMainAxisSpacer
      }
      .frame(maxWidth: verticalMaximumWidth, alignment: frameAlignment)
    case .horizontal:
      HStack(alignment: horizontalAlignment, spacing: component.gap) {
        leadingMainAxisSpacer
        childViews
        trailingMainAxisSpacer
      }
      .fixedSize(horizontal: usesContentWidth, vertical: false)
    }
  }

  private var childBounds: MosaicAxisBounds {
    parentBounds
      .constrained(by: component.sizing)
      .forStackChildren(direction: component.direction)
  }

  @ViewBuilder
  private var childViews: some View {
    ForEach(Array(children.enumerated()), id: \.element.id) { index, node in
      MosaicNodeView(
        node: node,
        document: document,
        localization: localization,
        model: model,
        imageResolver: imageResolver,
        productOption: nil
      )
      .mosaicStretchWidth(
        component.direction == .vertical && component.crossAxisAlignment == .stretch
      )
      if component.mainAxisDistribution == .spaceBetween,
        index < children.count - 1
      {
        Spacer(minLength: component.gap)
      }
    }
  }

  @ViewBuilder
  private var leadingMainAxisSpacer: some View {
    if component.mainAxisDistribution == .center || component.mainAxisDistribution == .end {
      Spacer(minLength: 0)
    }
  }

  @ViewBuilder
  private var trailingMainAxisSpacer: some View {
    if component.mainAxisDistribution == .center { Spacer(minLength: 0) }
  }

  private var verticalAlignment: HorizontalAlignment {
    switch component.crossAxisAlignment {
    case .start, .stretch: .leading
    case .center: .center
    case .end: .trailing
    }
  }

  private var horizontalAlignment: VerticalAlignment {
    switch component.crossAxisAlignment {
    case .start, .stretch: .top
    case .center: .center
    case .end: .bottom
    }
  }

  private var verticalMaximumWidth: CGFloat? {
    component.crossAxisAlignment == .stretch ? .infinity : nil
  }

  private var usesContentWidth: Bool {
    guard let width = component.sizing?.width else { return true }
    switch width {
    case .content, .fit: return true
    case .fill, .fixed: return false
    }
  }

  private var frameAlignment: Alignment {
    switch component.crossAxisAlignment {
    case .start, .stretch: .leading
    case .center: .center
    case .end: .trailing
    }
  }
}

@MainActor
private struct MosaicPurchaseButtonView: View {
  let component: MosaicPurchaseButtonComponent
  let localization: MosaicLocalizationResolver
  @ObservedObject var model: MosaicPaywallModel

  var body: some View {
    let busy = model.busyPurchaseButtonID == component.id
    Button {
      Task { await model.purchase(using: component) }
    } label: {
      MosaicStyledText(
        value: localization.resolve(busy ? component.inProgressLabel : component.label),
        typography: component.typography
      )
    }
    .buttonStyle(.plain)
    .disabled(!model.isPurchaseEnabled(component))
    .accessibilityLabel(Text(localization.resolve(component.accessibility.label)))
    .mosaicAccessibilityHint(component.accessibility.hint.map(localization.resolve))
    .mosaicBusyValue(busy ? localization.resolve(component.inProgressLabel) : nil)
    .mosaicDefaultButtonAppearance(component.appearance, kind: .purchase)
    .mosaicPresentation(
      appearance: component.appearance,
      sizing: component.sizing,
      outerInsets: component.outerInsets
    )
  }
}

@MainActor
private struct MosaicRestoreButtonView: View {
  let component: MosaicRestoreButtonComponent
  let localization: MosaicLocalizationResolver
  @ObservedObject var model: MosaicPaywallModel

  var body: some View {
    let busy = model.busyRestoreButtonID == component.id
    Button {
      Task { await model.restore(using: component) }
    } label: {
      MosaicStyledText(
        value: localization.resolve(busy ? component.inProgressLabel : component.label),
        typography: component.typography
      )
    }
    .buttonStyle(.plain)
    .disabled(!model.isRestoreEnabled(component))
    .accessibilityLabel(Text(localization.resolve(component.accessibility.label)))
    .mosaicAccessibilityHint(component.accessibility.hint.map(localization.resolve))
    .mosaicBusyValue(busy ? localization.resolve(component.inProgressLabel) : nil)
    .mosaicDefaultButtonAppearance(component.appearance, kind: .secondary)
    .mosaicPresentation(
      appearance: component.appearance,
      sizing: component.sizing,
      outerInsets: component.outerInsets
    )
  }
}

@MainActor
private struct MosaicCloseButtonView: View {
  let component: MosaicCloseButtonComponent
  let localization: MosaicLocalizationResolver
  @ObservedObject var model: MosaicPaywallModel

  var body: some View {
    Button {
      model.close(using: component)
    } label: {
      MosaicStyledText(
        value: localization.resolve(component.label), typography: component.typography)
    }
    .buttonStyle(.plain)
    .accessibilityLabel(Text(localization.resolve(component.accessibility.label)))
    .mosaicAccessibilityHint(component.accessibility.hint.map(localization.resolve))
    .mosaicDefaultButtonAppearance(component.appearance, kind: .secondary)
    .mosaicPresentation(
      appearance: component.appearance,
      sizing: component.sizing,
      outerInsets: component.outerInsets
    )
  }
}

private struct MosaicLegalTextView: View {
  let component: MosaicLegalTextComponent
  let localization: MosaicLocalizationResolver

  var body: some View {
    MosaicStyledText(value: localization.resolve(component.value), typography: component.typography)
      .mosaicTextAccessibilityLabel(component.accessibility, localization: localization)
      .mosaicPresentation(
        appearance: component.appearance,
        sizing: component.sizing,
        outerInsets: component.outerInsets
      )
  }
}

@MainActor
private struct MosaicSwitchView: View {
  @Environment(\.mosaicDocument) private var document
  let component: MosaicSwitchComponent
  let localization: MosaicLocalizationResolver
  @ObservedObject var model: MosaicPaywallModel

  var body: some View {
    Toggle(
      isOn: Binding(
        get: { model.switchValue(for: component.id) },
        set: { model.setSwitchValue($0, for: component.id) }
      )
    ) {
      MosaicStyledText(
        value: localization.resolve(component.label), typography: component.typography)
    }
    .toggleStyle(.switch)
    .tint(component.onTrackColor.swiftUI(in: document))
    .accessibilityLabel(Text(localization.resolve(component.accessibility.label)))
    .mosaicAccessibilityHint(component.accessibility.hint.map(localization.resolve))
    .mosaicPresentation(
      appearance: component.appearance,
      sizing: component.sizing,
      outerInsets: component.outerInsets
    )
  }
}

@MainActor
private struct MosaicCarouselView: View {
  @Environment(\.mosaicAxisBounds) private var parentBounds
  let component: MosaicCarouselComponent
  let document: MosaicPaywallDocument
  let localization: MosaicLocalizationResolver
  @ObservedObject var model: MosaicPaywallModel
  let imageResolver: MosaicImageResolver

  private var selection: Binding<Int> {
    Binding(
      get: { model.carouselPageIndex(for: component.id) },
      set: { model.setCarouselPageIndex($0, for: component.id) }
    )
  }

  var body: some View {
    carousel
      .environment(\.mosaicAxisBounds, parentBounds.constrained(by: component.sizing))
      .accessibilityElement(children: .contain)
      .accessibilityLabel(Text(localization.resolve(component.accessibility.label)))
      .mosaicAccessibilityHint(component.accessibility.hint.map(localization.resolve))
      .mosaicPresentation(
        appearance: component.appearance,
        sizing: component.sizing,
        outerInsets: component.outerInsets
      )
  }

  @ViewBuilder
  private var carousel: some View {
    #if os(iOS)
      ZStack {
        ForEach(component.pages) { page in
          pageView(page)
            .fixedSize(horizontal: false, vertical: true)
            .opacity(0)
            .accessibilityHidden(true)
        }
        TabView(selection: selection) {
          ForEach(Array(component.pages.enumerated()), id: \.element.id) { index, page in
            pageView(page)
              .tag(index)
              .accessibilityLabel(Text(localization.resolve(page.accessibilityLabel)))
          }
        }
        .tabViewStyle(
          PageTabViewStyle(indexDisplayMode: component.showsIndicators ? .automatic : .never)
        )
      }
    #else
      VStack(spacing: 8) {
        pageView(component.pages[selection.wrappedValue])
        if component.showsIndicators {
          Picker("Page", selection: selection) {
            ForEach(Array(component.pages.enumerated()), id: \.element.id) { index, page in
              Text(localization.resolve(page.accessibilityLabel)).tag(index)
            }
          }
          .pickerStyle(.segmented)
        }
      }
    #endif
  }

  private func pageView(_ page: MosaicCarouselPage) -> some View {
    MosaicStackView(
      stack: page.content,
      document: document,
      localization: localization,
      model: model,
      imageResolver: imageResolver,
      productOption: nil
    )
  }
}

@MainActor
private struct MosaicCountdownView: View {
  let component: MosaicCountdownComponent
  let localization: MosaicLocalizationResolver
  @ObservedObject var model: MosaicPaywallModel

  var body: some View {
    TimelineView(.periodic(from: .now, by: 1)) { _ in
      MosaicStyledText(
        value: MosaicCountdownText.resolve(
          component: component,
          now: model.currentDate(),
          completedText: localization.resolve(component.completedText)
        ),
        typography: component.typography
      )
      .mosaicHeading(component.accessibility)
      .mosaicTextAccessibilityLabel(component.accessibility, localization: localization)
    }
    .mosaicPresentation(
      appearance: component.appearance,
      sizing: component.sizing,
      outerInsets: component.outerInsets
    )
  }
}

public enum MosaicCountdownText {
  public static func resolve(
    component: MosaicCountdownComponent,
    now: Date,
    completedText: String
  ) -> String {
    let formatter = ISO8601DateFormatter()
    formatter.formatOptions = [.withInternetDateTime]
    guard let end = formatter.date(from: component.endsAt) else { return completedText }
    let remaining = max(0, Int(end.timeIntervalSince(now).rounded(.down)))
    guard remaining > 0 else { return completedText }

    let units: [(MosaicCountdownUnit, Int, String)] = [
      (.day, 86_400, "d"), (.hour, 3_600, "h"), (.minute, 60, "m"), (.second, 1, "s"),
    ]
    var rest = remaining
    var values: [String] = []
    for (unit, divisor, suffix) in units
    where unit.rank <= component.largestUnit.rank && unit.rank >= component.smallestUnit.rank {
      let value = rest / divisor
      rest %= divisor
      values.append("\(value)\(suffix)")
    }
    return values.joined(separator: " ")
  }
}

private enum MosaicDefaultButtonKind { case purchase, secondary }

private struct MosaicAxisBounds: Equatable, Sendable {
  let width: Bool
  let height: Bool

  func constrained(by sizing: MosaicBoxSizing?) -> MosaicAxisBounds {
    guard let sizing else { return self }
    return MosaicAxisBounds(
      width: constrainedWidth(by: sizing.width),
      height: constrainedHeight(by: sizing.height)
    )
  }

  func forStackChildren(direction: MosaicStackDirection) -> MosaicAxisBounds {
    switch direction {
    case .vertical:
      MosaicAxisBounds(width: width, height: false)
    case .horizontal:
      MosaicAxisBounds(width: false, height: height)
    }
  }

  private func constrainedWidth(by sizing: MosaicWidthSizing?) -> Bool {
    switch sizing {
    case .fixed: true
    case .content, .fill, .fit, .none: width
    }
  }

  private func constrainedHeight(by sizing: MosaicHeightSizing?) -> Bool {
    switch sizing {
    case .fixed: true
    case .content, .fill, .fit, .none: height
    }
  }
}

private struct MosaicDocumentEnvironmentKey: EnvironmentKey {
  static let defaultValue: MosaicPaywallDocument? = nil
}

private struct MosaicImageResolverEnvironmentKey: EnvironmentKey {
  static let defaultValue = MosaicImageResolver.missing
}

private struct MosaicVideoResolverEnvironmentKey: EnvironmentKey {
  static let defaultValue = MosaicVideoResolver.missing
}

private struct MosaicAxisBoundsEnvironmentKey: EnvironmentKey {
  static let defaultValue = MosaicAxisBounds(width: true, height: false)
}

extension EnvironmentValues {
  fileprivate var mosaicDocument: MosaicPaywallDocument? {
    get { self[MosaicDocumentEnvironmentKey.self] }
    set { self[MosaicDocumentEnvironmentKey.self] = newValue }
  }

  @MainActor fileprivate var mosaicImageResolver: MosaicImageResolver {
    get { self[MosaicImageResolverEnvironmentKey.self] }
    set { self[MosaicImageResolverEnvironmentKey.self] = newValue }
  }

  @MainActor fileprivate var mosaicVideoResolver: MosaicVideoResolver {
    get { self[MosaicVideoResolverEnvironmentKey.self] }
    set { self[MosaicVideoResolverEnvironmentKey.self] = newValue }
  }

  fileprivate var mosaicAxisBounds: MosaicAxisBounds {
    get { self[MosaicAxisBoundsEnvironmentKey.self] }
    set { self[MosaicAxisBoundsEnvironmentKey.self] = newValue }
  }
}

@MainActor
private struct MosaicBackgroundView: View {
  @Environment(\.mosaicDocument) private var document
  @Environment(\.mosaicImageResolver) private var imageResolver
  @Environment(\.mosaicVideoResolver) private var videoResolver
  @EnvironmentObject private var model: MosaicPaywallModel

  let background: MosaicBackground

  @ViewBuilder
  var body: some View {
    if let document, let resolved = document.resolvedBackground(background) {
      content(resolved, document: document)
        .accessibilityHidden(true)
    } else {
      Color.clear.accessibilityHidden(true)
    }
  }

  @ViewBuilder
  private func content(_ background: MosaicBackground, document: MosaicPaywallDocument) -> some View
  {
    switch background {
    case .color(let color):
      color.swiftUI(in: document)
    case .linearGradient(let angle, let stops):
      let points = MosaicGradientGeometry.endpoints(angle: angle)
      LinearGradient(
        stops: stops.map {
          .init(color: $0.color.swiftUI(in: document), location: $0.position)
        },
        startPoint: UnitPoint(x: points.start.x, y: points.start.y),
        endPoint: UnitPoint(x: points.end.x, y: points.end.y)
      )
    case .radialGradient(let center, let radius, let stops):
      GeometryReader { geometry in
        RadialGradient(
          stops: stops.map {
            .init(color: $0.color.swiftUI(in: document), location: $0.position)
          },
          center: UnitPoint(x: center.x, y: center.y),
          startRadius: 0,
          endRadius: max(geometry.size.width, geometry.size.height) * radius
        )
      }
    case .image(let assetID, let mode, let fallback):
      mediaImage(
        assetID: assetID,
        mode: mode,
        fallback: fallback.swiftUI(in: document),
        diagnostic: "media_image_background_unavailable")
    case .video(let assetID, let posterID, let mode, let fallback):
      video(
        assetID: assetID,
        posterID: posterID,
        mode: mode,
        fallback: fallback.swiftUI(in: document))
    case .token:
      Color.clear
    }
  }

  @ViewBuilder
  private func mediaImage(
    assetID: String,
    mode: MosaicImageContentMode,
    fallback: Color,
    diagnostic: String
  ) -> some View {
    if let asset = document?.assets.first(where: { $0.id == assetID }) {
      switch asset.source {
      case .bundled(let key):
        if let image = imageResolver.image(for: key) {
          image.resizable().mosaicMediaContentMode(mode)
        } else {
          fallback.task { model.recordRenderingDiagnosticOnce(diagnostic, subjectID: assetID) }
        }
      case .remote(let url):
        AsyncImage(url: url) { phase in
          switch phase {
          case .success(let image): image.resizable().mosaicMediaContentMode(mode)
          case .empty: fallback
          case .failure:
            fallback.task { model.recordRenderingDiagnosticOnce(diagnostic, subjectID: assetID) }
          @unknown default: fallback
          }
        }
      }
    } else {
      fallback.task { model.recordRenderingDiagnosticOnce(diagnostic, subjectID: assetID) }
    }
  }

  @ViewBuilder
  private func video(
    assetID: String,
    posterID: String?,
    mode: MosaicImageContentMode,
    fallback: Color
  ) -> some View {
    let url = document?.assets.first(where: { $0.id == assetID }).flatMap { asset -> URL? in
      switch asset.source {
      case .bundled(let key): videoResolver.url(for: key)
      case .remote(let url): url
      }
    }
    if let url {
      MosaicDecorativeVideoView(url: url, contentMode: mode) {
        model.recordRenderingDiagnosticOnce(
          "media_video_background_unavailable", subjectID: assetID)
      } fallback: {
        posterOrFallback(posterID: posterID, mode: mode, fallback: fallback)
      }
    } else {
      posterOrFallback(posterID: posterID, mode: mode, fallback: fallback)
        .task {
          model.recordRenderingDiagnosticOnce(
            "media_video_background_unavailable", subjectID: assetID)
        }
    }
  }

  @ViewBuilder
  private func posterOrFallback(
    posterID: String?,
    mode: MosaicImageContentMode,
    fallback: Color
  ) -> some View {
    if let posterID {
      mediaImage(
        assetID: posterID,
        mode: mode,
        fallback: fallback,
        diagnostic: "media_video_poster_unavailable")
    } else {
      fallback
    }
  }

}

enum MosaicGradientGeometry {
  static func endpoints(
    angle: Double
  ) -> (start: MosaicNormalizedPoint, end: MosaicNormalizedPoint) {
    let radians = angle * .pi / 180
    let dx = cos(radians) / 2
    let dy = sin(radians) / 2
    return (
      MosaicNormalizedPoint(x: 0.5 - dx, y: 0.5 - dy),
      MosaicNormalizedPoint(x: 0.5 + dx, y: 0.5 + dy)
    )
  }
}

@MainActor
private final class MosaicLoopingVideoModel: ObservableObject {
  @Published private(set) var failed = false
  let player: AVQueuePlayer
  private var looper: AVPlayerLooper?
  private var observation: NSKeyValueObservation?

  init(url: URL) {
    let item = AVPlayerItem(url: url)
    player = AVQueuePlayer()
    player.isMuted = true
    looper = AVPlayerLooper(player: player, templateItem: item)
    observation = item.observe(\.status, options: [.initial, .new]) { [weak self] item, _ in
      Task { @MainActor in
        guard let self else { return }
        if item.status == .failed { self.failed = true }
      }
    }
    player.play()
  }

  deinit { observation?.invalidate() }
}

@MainActor
private struct MosaicDecorativeVideoView<Fallback: View>: View {
  @StateObject private var video: MosaicLoopingVideoModel
  let contentMode: MosaicImageContentMode
  let onFailure: @MainActor () -> Void
  @ViewBuilder let fallback: () -> Fallback

  init(
    url: URL,
    contentMode: MosaicImageContentMode,
    onFailure: @escaping @MainActor () -> Void,
    @ViewBuilder fallback: @escaping () -> Fallback
  ) {
    _video = StateObject(wrappedValue: MosaicLoopingVideoModel(url: url))
    self.contentMode = contentMode
    self.onFailure = onFailure
    self.fallback = fallback
  }

  var body: some View {
    if video.failed {
      fallback().task { onFailure() }
    } else {
      MosaicPlayerLayerView(player: video.player, contentMode: contentMode)
        .onAppear { video.player.play() }
        .onDisappear { video.player.pause() }
    }
  }
}

#if os(iOS)
  private struct MosaicPlayerLayerView: UIViewRepresentable {
    let player: AVPlayer
    let contentMode: MosaicImageContentMode

    func makeUIView(context: Context) -> MosaicPlayerUIView {
      let view = MosaicPlayerUIView()
      view.configure(player: player, contentMode: contentMode)
      return view
    }

    func updateUIView(_ view: MosaicPlayerUIView, context: Context) {
      view.configure(player: player, contentMode: contentMode)
    }
  }

  private final class MosaicPlayerUIView: UIView {
    override class var layerClass: AnyClass { AVPlayerLayer.self }

    func configure(player: AVPlayer, contentMode: MosaicImageContentMode) {
      guard let playerLayer = layer as? AVPlayerLayer else { return }
      playerLayer.player = player
      playerLayer.videoGravity = contentMode == .fill ? .resizeAspectFill : .resizeAspect
    }
  }
#else
  private struct MosaicPlayerLayerView: NSViewRepresentable {
    let player: AVPlayer
    let contentMode: MosaicImageContentMode

    func makeNSView(context: Context) -> MosaicPlayerNSView {
      MosaicPlayerNSView(player: player, contentMode: contentMode)
    }

    func updateNSView(_ view: MosaicPlayerNSView, context: Context) {
      view.playerLayer.player = player
      view.playerLayer.videoGravity = contentMode == .fill ? .resizeAspectFill : .resizeAspect
    }
  }

  private final class MosaicPlayerNSView: NSView {
    let playerLayer = AVPlayerLayer()
    init(player: AVPlayer, contentMode: MosaicImageContentMode) {
      super.init(frame: .zero)
      wantsLayer = true
      layer = playerLayer
      playerLayer.player = player
      playerLayer.videoGravity = contentMode == .fill ? .resizeAspectFill : .resizeAspect
    }
    required init?(coder: NSCoder) { nil }
  }
#endif

private struct MosaicAppearanceModifier: ViewModifier {
  @Environment(\.mosaicDocument) private var document
  let appearance: MosaicBoxAppearance?

  func body(content: Content) -> some View {
    let radius = appearance?.cornerRadius ?? 0
    content
      .padding(.top, appearance?.padding?.top ?? 0)
      .padding(.leading, appearance?.padding?.start ?? 0)
      .padding(.bottom, appearance?.padding?.bottom ?? 0)
      .padding(.trailing, appearance?.padding?.end ?? 0)
      .background {
        if let background = appearance?.background {
          MosaicBackgroundView(background: background)
            .clipShape(RoundedRectangle(cornerRadius: radius, style: .continuous))
        }
      }
      .overlay {
        if let border = appearance?.border {
          RoundedRectangle(cornerRadius: radius, style: .continuous)
            .stroke(border.color.swiftUI(in: document), lineWidth: border.width)
        }
      }
      .opacity(appearance?.opacity ?? 1)
      .mosaicClipShape(appearance?.clipContent == true, radius: radius)
      .mosaicShadow(appearance?.shadow)
  }
}

private struct MosaicSizingModifier: ViewModifier {
  @Environment(\.mosaicAxisBounds) private var bounds
  @EnvironmentObject private var model: MosaicPaywallModel
  let sizing: MosaicBoxSizing?

  @ViewBuilder
  func body(content: Content) -> some View {
    if let sizing {
      applyHeight(applyWidth(content, sizing.width), sizing.height)
    } else {
      content
    }
  }

  @ViewBuilder
  private func applyWidth<V: View>(_ content: V, _ width: MosaicWidthSizing?) -> some View {
    switch width {
    case .fill where bounds.width:
      content.frame(maxWidth: .infinity)
    case .fill:
      content.task {
        model.recordRenderingDiagnosticOnce("layout.unboundedFill", subjectID: "width")
      }
    case .fixed(let value):
      content.frame(width: value).clipped()
    case .content, .fit, .none:
      content
    }
  }

  @ViewBuilder
  private func applyHeight<V: View>(_ content: V, _ height: MosaicHeightSizing?) -> some View {
    switch height {
    case .fill where bounds.height:
      content.frame(maxHeight: .infinity)
    case .fill:
      content.task {
        model.recordRenderingDiagnosticOnce("layout.unboundedFill", subjectID: "height")
      }
    case .fixed(let value):
      content.frame(height: value).clipped()
    case .content, .fit, .none:
      content
    }
  }
}

private struct MosaicShadowModifier: ViewModifier {
  @Environment(\.mosaicDocument) private var document
  let shadow: MosaicShadow?

  @ViewBuilder
  func body(content: Content) -> some View {
    if let document, let shadow, let resolved = document.resolvedShadow(shadow),
      case .value(let color, let x, let y, let blur) = resolved
    {
      content.shadow(
        color: color.swiftUI(in: document), radius: blur, x: x, y: y)
    } else {
      content
    }
  }
}

extension View {
  @ViewBuilder
  fileprivate func mosaicScreenAccessibilityLabel(_ label: String?) -> some View {
    if let label {
      accessibilityElement(children: .contain)
        .accessibilityLabel(Text(label))
    } else {
      self
    }
  }

  fileprivate func mosaicPresentation(
    appearance: MosaicBoxAppearance?,
    sizing: MosaicBoxSizing?,
    outerInsets: MosaicEdgeInsets?
  ) -> some View {
    modifier(MosaicAppearanceModifier(appearance: appearance))
      .mosaicSizing(sizing)
      .padding(.top, outerInsets?.top ?? 0)
      .padding(.leading, outerInsets?.start ?? 0)
      .padding(.bottom, outerInsets?.bottom ?? 0)
      .padding(.trailing, outerInsets?.end ?? 0)
  }

  @ViewBuilder
  fileprivate func mosaicSizing(_ sizing: MosaicBoxSizing?) -> some View {
    modifier(MosaicSizingModifier(sizing: sizing))
  }

  @ViewBuilder
  fileprivate func mosaicWidth(_ width: MosaicWidthSizing?) -> some View {
    switch width {
    case .fill: frame(maxWidth: .infinity)
    case .fixed(let value): frame(width: value)
    case .content, .fit, .none: self
    }
  }

  @ViewBuilder
  fileprivate func mosaicHeight(_ height: MosaicHeightSizing?) -> some View {
    switch height {
    case .fill: self
    case .fixed(let value): frame(height: value)
    case .content, .fit, .none: self
    }
  }

  @ViewBuilder
  fileprivate func mosaicImageDimensions(_ image: MosaicImageComponent) -> some View {
    if image.sizing == nil {
      if let ratio = image.aspectRatio {
        mosaicWidth(image.width).aspectRatio(ratio, contentMode: .fit)
      } else if let height = image.height {
        mosaicWidth(image.width).frame(height: height)
      } else {
        mosaicWidth(image.width)
      }
    } else if let ratio = image.aspectRatio {
      aspectRatio(ratio, contentMode: .fit)
    } else {
      self
    }
  }

  @ViewBuilder
  fileprivate func mosaicStretchWidth(_ stretch: Bool) -> some View {
    if stretch { frame(maxWidth: .infinity) } else { self }
  }

  fileprivate func mosaicShadow(_ shadow: MosaicShadow?) -> some View {
    modifier(MosaicShadowModifier(shadow: shadow))
  }

  @ViewBuilder
  fileprivate func mosaicMediaContentMode(_ mode: MosaicImageContentMode) -> some View {
    switch mode {
    case .fit: scaledToFit()
    case .fill: scaledToFill()
    }
  }

  @ViewBuilder
  fileprivate func mosaicClipShape(_ clip: Bool, radius: Double) -> some View {
    if clip {
      clipShape(RoundedRectangle(cornerRadius: radius, style: .continuous))
    } else {
      self
    }
  }

  @ViewBuilder
  fileprivate func mosaicClipText(_ clip: Bool) -> some View {
    if clip { clipped() } else { self }
  }

  @ViewBuilder
  fileprivate func mosaicDefaultButtonAppearance(
    _ appearance: MosaicBoxAppearance?, kind: MosaicDefaultButtonKind
  ) -> some View {
    if appearance == nil {
      switch kind {
      case .purchase:
        padding(.vertical, 14)
          .padding(.horizontal, 18)
          .background(Color.accentColor, in: RoundedRectangle(cornerRadius: 10))
          .foregroundColor(.white)
      case .secondary:
        padding(.vertical, 10)
          .padding(.horizontal, 14)
          .overlay(RoundedRectangle(cornerRadius: 9).stroke(Color.secondary.opacity(0.35)))
      }
    } else {
      self
    }
  }

  @ViewBuilder
  fileprivate func mosaicHeading(_ accessibility: MosaicTextAccessibility) -> some View {
    if accessibility.headingLevel != nil { accessibilityAddTraits(.isHeader) } else { self }
  }

  @ViewBuilder
  fileprivate func mosaicTextAccessibilityLabel(
    _ accessibility: MosaicTextAccessibility,
    localization: MosaicLocalizationResolver
  ) -> some View {
    if let label = accessibility.label {
      accessibilityLabel(Text(localization.resolve(label)))
    } else {
      self
    }
  }

  @ViewBuilder
  fileprivate func mosaicImageAccessibility(
    _ accessibility: MosaicImageAccessibility,
    localization: MosaicLocalizationResolver
  ) -> some View {
    switch accessibility {
    case .decorative: accessibilityHidden(true)
    case .informative(let label): accessibilityLabel(Text(localization.resolve(label)))
    }
  }

  @ViewBuilder
  fileprivate func mosaicAccessibilityHint(_ hint: String?) -> some View {
    if let hint { accessibilityHint(Text(hint)) } else { self }
  }

  @ViewBuilder
  fileprivate func mosaicSelected(_ selected: Bool) -> some View {
    if selected { accessibilityAddTraits(.isSelected) } else { self }
  }

  @ViewBuilder
  fileprivate func mosaicBusyValue(_ value: String?) -> some View {
    if let value { accessibilityValue(Text(value)) } else { self }
  }
}

extension MosaicIconName {
  fileprivate var systemName: String {
    switch self {
    case .checkmark: "checkmark"
    case .close: "xmark"
    case .lock: "lock"
    case .restore: "arrow.clockwise"
    case .externalLink: "arrow.up.right.square"
    case .arrowBackward: "arrow.backward"
    case .arrowForward: "arrow.forward"
    case .chevronBackward: "chevron.backward"
    case .chevronForward: "chevron.forward"
    }
  }
}

extension MosaicTextAlignment {
  fileprivate var swiftUI: TextAlignment {
    switch self {
    case .start: .leading
    case .center: .center
    case .end: .trailing
    }
  }

  fileprivate var frameAlignment: Alignment {
    switch self {
    case .start: .leading
    case .center: .center
    case .end: .trailing
    }
  }
}

extension MosaicFontWeight {
  fileprivate var swiftUI: Font.Weight {
    switch self {
    case .regular: .regular
    case .medium: .medium
    case .semibold: .semibold
    case .bold: .bold
    }
  }
}

extension MosaicColor {
  fileprivate var swiftUI: Color {
    swiftUI(in: nil)
  }

  fileprivate func swiftUI(in document: MosaicPaywallDocument?) -> Color {
    let resolved = document?.resolvedColor(self) ?? self
    switch resolved {
    case .semantic(let semantic):
      switch semantic {
      case .textPrimary: return Color.primary
      case .textSecondary: return Color.secondary
      case .surfaceDefault:
        #if os(iOS)
          return Color(uiColor: .systemBackground)
        #else
          return Color(nsColor: .windowBackgroundColor)
        #endif
      case .surfaceElevated:
        #if os(iOS)
          return Color(uiColor: .secondarySystemBackground)
        #else
          return Color(nsColor: .controlBackgroundColor)
        #endif
      case .actionPrimary: return Color.accentColor
      case .actionOnPrimary: return Color.white
      case .borderDefault: return Color.secondary.opacity(0.3)
      case .transparent: return Color.clear
      }
    case .literal(let raw):
      guard raw.count == 9 else { return .clear }
      let value = String(raw.dropFirst())
      guard let rgba = UInt64(value, radix: 16) else { return .clear }
      return Color(
        red: Double((rgba >> 24) & 0xFF) / 255,
        green: Double((rgba >> 16) & 0xFF) / 255,
        blue: Double((rgba >> 8) & 0xFF) / 255,
        opacity: Double(rgba & 0xFF) / 255
      )
    case .token:
      return .clear
    }
  }
}
