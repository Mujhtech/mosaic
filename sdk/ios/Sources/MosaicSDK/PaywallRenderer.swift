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

/// Native SwiftUI renderer for validated Mosaic Protocol 0.3 documents.
/// The host application retains ownership of sheet or full-screen dismissal.
@MainActor
public struct MosaicPaywall: View {
  @Environment(\.accessibilityReduceMotion) private var systemPrefersReducedMotion
  @StateObject private var model: MosaicPaywallModel
  @StateObject private var motionDriver: MosaicMotionDriver
  private let imageResolver: MosaicImageResolver
  private let videoResolver: MosaicVideoResolver
  private let motionAccessibility: MosaicMotionAccessibility?

  public init(
    document: MosaicPaywallDocument,
    requestedLocale: String? = nil,
    purchaseProvider: any MosaicPurchaseProvider,
    imageResolver: MosaicImageResolver = .missing,
    videoResolver: MosaicVideoResolver = .missing,
    clock: @escaping @Sendable () -> Date = { Date() },
    motionDriver: @autoclosure @escaping () -> MosaicMotionDriver = .platform(),
    /// The reduced-motion and video-autoplay signals. `nil` reads the platform's
    /// current answer at the renderer boundary.
    motionAccessibility: MosaicMotionAccessibility? = nil,
    analytics: MosaicAnalyticsPresentationInstrumentation? = nil,
    presentationDiagnostics: [String] = [],
    onInteraction: @escaping @MainActor (MosaicInteractionOutcome) -> Void = { _ in },
    onResult: @escaping @MainActor (MosaicPresentationResult) -> Void
  ) {
    _model = StateObject(
      wrappedValue: MosaicPaywallModel(
        document: document,
        requestedLocale: requestedLocale,
        purchaseProvider: purchaseProvider,
        clock: clock,
        analytics: analytics,
        presentationDiagnostics: presentationDiagnostics,
        onInteraction: onInteraction,
        onResult: onResult
      )
    )
    _motionDriver = StateObject(wrappedValue: motionDriver())
    self.imageResolver = imageResolver
    self.videoResolver = videoResolver
    self.motionAccessibility = motionAccessibility
  }

  public init(
    model: @autoclosure @escaping () -> MosaicPaywallModel,
    imageResolver: MosaicImageResolver = .missing,
    videoResolver: MosaicVideoResolver = .missing,
    motionDriver: @autoclosure @escaping () -> MosaicMotionDriver = .platform(),
    motionAccessibility: MosaicMotionAccessibility? = nil
  ) {
    _model = StateObject(wrappedValue: model())
    _motionDriver = StateObject(wrappedValue: motionDriver())
    self.imageResolver = imageResolver
    self.videoResolver = videoResolver
    self.motionAccessibility = motionAccessibility
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
      .environmentObject(motionDriver)
      // Resolved once, here, so no view deeper in the tree samples the platform
      // for itself and no test has to configure the simulator to state a
      // preference.
      .environment(\.mosaicMotionAccessibility, resolvedMotionAccessibility)
      .environment(\.layoutDirection, swiftUILayoutDirection)
      .environment(\.locale, Locale(identifier: model.localization.resolvedLocale.effectiveLocale))
      // `appear` and `loop` both measure from node entry, and the base screen is
      // what actually swaps a screen's nodes. A sheet is presented over it and
      // leaves its nodes in place, so it is deliberately not an entry: replaying
      // the screen underneath when a sheet closed would animate content that
      // never left.
      .onAppear { motionDriver.enterScreen(model.baseScreen?.id) }
      .onChange(of: model.baseScreen?.id) { motionDriver.enterScreen($0) }
      .task { await model.prepare() }
  }

  private var resolvedMotionAccessibility: MosaicMotionAccessibility {
    motionAccessibility
      ?? MosaicMotionAccessibility(
        prefersReducedMotion: systemPrefersReducedMotion,
        allowsVideoAutoplay: MosaicMotionAccessibility.systemAllowsVideoAutoplay
      )
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
      // A screen's root content stack is reached directly rather than as a
      // node, so its entrance is attached here. The screen Scroll Container
      // itself carries no motion: it is viewport-owned rather than authored.
      .mosaicAppearMotion(layout.content.motion, in: model.document)
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
struct MosaicStackView: View {
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
struct MosaicNodeView: View {
  let node: MosaicNode
  let document: MosaicPaywallDocument
  let localization: MosaicLocalizationResolver
  @ObservedObject var model: MosaicPaywallModel
  let imageResolver: MosaicImageResolver
  let productOption: MosaicResolvedProductOption?

  @ViewBuilder
  var body: some View {
    if model.isVisible(node.visibility) {
      // Every node kind's entrance is attached in exactly one place. Motion
      // never touches the accessibility tree: a node mid-entrance is already
      // present, focusable, and announceable.
      nodeContent.mosaicAppearMotion(node.motion, in: document)
    }
  }

  @ViewBuilder
  private var nodeContent: some View {
    switch node {
    case .stack(let stack):
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
    case .tabs(let component):
      MosaicTabsView(
        component: component,
        document: document,
        localization: localization,
        model: model,
        imageResolver: imageResolver
      )
    case .timeline(let component):
      MosaicTimelineView(component: component, localization: localization)
    case .award(let component):
      MosaicAwardView(
        component: component,
        asset: {
          guard let assetID = component.emblem?.imageAssetID else { return nil }
          return document.assets.first { $0.id == assetID }
        }(),
        localization: localization,
        resolver: imageResolver
      )
    case .socialProof(let component):
      MosaicSocialProofView(
        component: component,
        asset: {
          guard let assetID = component.avatar?.assetId else { return nil }
          return document.assets.first { $0.id == assetID }
        }(),
        localization: localization,
        resolver: imageResolver
      )
    }
  }
}

struct MosaicStyledText: View {
  @Environment(\.mosaicDocument) private var document
  let value: String
  let typography: MosaicTypography

  var body: some View {
    let rendered = typography.color.rendered(in: document, role: .content)
    return Text(value)
      .font(.system(size: typography.fontSize, weight: typography.weight.swiftUI))
      .foregroundStyle(rendered.color)
      .lineSpacing(max(0, typography.fontSize * (typography.lineHeightMultiplier - 1)))
      .multilineTextAlignment(typography.alignment.swiftUI)
      .lineLimit(typography.maxLines)
      .truncationMode(.tail)
      .frame(maxWidth: .infinity, alignment: typography.alignment.frameAlignment)
      .fixedSize(horizontal: false, vertical: typography.maxLines == nil)
      .mosaicClipText(typography.overflow == .clip)
      .mosaicStyleDiagnostics(rendered.failure)
  }
}

struct MosaicTextView: View {
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
struct MosaicImageView: View {
  @EnvironmentObject private var model: MosaicPaywallModel
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
          imageFallback(asset, diagnostic: "media_image_unavailable")
        }
      case .remote(let url):
        AsyncImage(url: url) { phase in
          switch phase {
          case .success(let image): image.resizable().mosaicMediaContentMode(component.contentMode)
          // `.empty` is "still loading", not a failure, so it must not diagnose.
          case .empty: imageFallback(asset, diagnostic: nil)
          case .failure: imageFallback(asset, diagnostic: "media_image_unavailable")
          @unknown default: imageFallback(asset, diagnostic: "media_image_unavailable")
          }
        }
      }
    } else {
      imageFallback(nil, diagnostic: "media_image_asset_missing")
    }
  }

  /// The declared asset fallback, matching the background media path: the same
  /// recovery, and the same once-per-subject diagnostics, so a component image
  /// that never appears is as visible in diagnostics as a background that does
  /// not.
  private func imageFallback(_ asset: MosaicAsset?, diagnostic: String?) -> some View {
    let text = asset?.fallback.map { localization.resolve($0.value) } ?? ""
    return ZStack {
      Color.secondary.opacity(0.12)
      Text(text)
        .font(.body)
        .foregroundStyle(.secondary)
        .multilineTextAlignment(.center)
        .padding()
    }
    .task {
      guard let diagnostic else { return }
      model.recordRenderingDiagnosticOnce(diagnostic, subjectID: component.assetId)
      if text.isEmpty {
        model.recordRenderingDiagnosticOnce(
          "media_image_fallback_text_missing", subjectID: component.assetId)
      }
    }
  }
}

struct MosaicIconView: View {
  @Environment(\.mosaicDocument) private var document
  let component: MosaicIconComponent
  let localization: MosaicLocalizationResolver

  var body: some View {
    let rendered = component.color.rendered(in: document, role: .content)
    return Image(systemName: component.name.systemName)
      .font(.system(size: component.size, weight: .regular))
      .foregroundStyle(rendered.color)
      .mosaicStyleDiagnostics(rendered.failure)
      .mosaicImageAccessibility(component.accessibility, localization: localization)
      .mosaicPresentation(
        appearance: component.appearance,
        sizing: component.sizing,
        outerInsets: component.outerInsets
      )
  }
}

struct MosaicFeatureListView: View {
  @Environment(\.mosaicDocument) private var document
  let component: MosaicFeatureListComponent
  let localization: MosaicLocalizationResolver

  /// The glyph drawn beside the item at `index`: the item's own marker, or the
  /// list's when it declares none. An absent item marker is never a request for
  /// no glyph.
  ///
  /// `body` reads this and nothing else, so the rendered glyph and the one a
  /// test asks for cannot diverge.
  func marker(at index: Int) -> MosaicMarker {
    component.marker(for: component.items[index])
  }

  var body: some View {
    let markerStyle = component.markerColor.rendered(in: document, role: .content)
    return VStack(alignment: .leading, spacing: component.gap) {
      ForEach(Array(component.items.enumerated()), id: \.element.id) { index, item in
        HStack(alignment: .firstTextBaseline, spacing: 10) {
          MosaicMarkerGlyph(
            marker: marker(at: index),
            ordinal: index + 1,
            color: markerStyle.color,
            // Marker colour and size stay component-level, exactly as they are
            // on Timeline. An unauthored size falls back to the list's own
            // typography rather than to a renderer constant.
            extent: component.markerExtent
          )
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
    .mosaicStyleDiagnostics(markerStyle.failure)
    .mosaicPresentation(
      appearance: component.appearance,
      sizing: component.sizing,
      outerInsets: component.outerInsets
    )
  }
}

@MainActor
struct MosaicProductSelectorView: View {
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
          selectionMotion: component.motion?.selection,
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
          document: document,
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
struct MosaicAuthoredProductCardView: View {
  @Environment(\.mosaicDocument) private var environmentDocument
  @Environment(\.mosaicAxisBounds) private var parentBounds
  let card: MosaicProductCardComponent
  let option: MosaicResolvedProductOption
  let selected: Bool
  let document: MosaicPaywallDocument
  let localization: MosaicLocalizationResolver
  @ObservedObject var model: MosaicPaywallModel
  let imageResolver: MosaicImageResolver
  /// The owning Product Selector's `selection` motion, if it declares one.
  /// Selection is the selector's state, so the motion that describes a change of
  /// it is authored there and applied here.
  let selectionMotion: MosaicSelectionMotion?
  let onSelect: () -> Void

  private func borderColor(_ style: MosaicSelectionStateStyle) -> MosaicRenderedColor {
    style.border.color.rendered(in: document, role: .decoration)
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
    MosaicSelectionStyledContent(
      styles: card.styles,
      selected: selected,
      motion: selectionMotion,
      curve: selectionMotion.flatMap { document.resolvedMotionCurve($0.curve) },
      content: cardBody
    )
  }

  private func cardBody(style: MosaicSelectionStateStyle) -> some View {
    Button(action: onSelect) {
      MosaicProductCardContentView(
        card: card,
        option: option,
        selected: selected,
        document: document,
        localization: localization,
        model: model,
        imageResolver: imageResolver,
        selectionMotion: selectionMotion
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
            imageResolver: imageResolver,
            selectionMotion: selectionMotion
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
        .strokeBorder(borderColor(style).color, lineWidth: style.border.width)
    }
    .mosaicStyleDiagnostics(borderColor(style).failure)
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
struct MosaicProductCardContentView: View {
  @Environment(\.mosaicAxisBounds) private var parentBounds
  let card: MosaicProductCardComponent
  let option: MosaicResolvedProductOption
  let selected: Bool
  let document: MosaicPaywallDocument
  let localization: MosaicLocalizationResolver
  @ObservedObject var model: MosaicPaywallModel
  let imageResolver: MosaicImageResolver
  let selectionMotion: MosaicSelectionMotion?

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
        imageResolver: imageResolver,
        selectionMotion: selectionMotion
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
struct MosaicProductCardChildView: View {
  let child: MosaicProductCardChild
  let option: MosaicResolvedProductOption
  let selected: Bool
  let document: MosaicPaywallDocument
  let localization: MosaicLocalizationResolver
  @ObservedObject var model: MosaicPaywallModel
  let imageResolver: MosaicImageResolver
  let selectionMotion: MosaicSelectionMotion?

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
          imageResolver: imageResolver,
          selectionMotion: selectionMotion
        )
      }
    }
  }
}

@MainActor
struct MosaicProductBadgeView: View {
  @Environment(\.mosaicDocument) private var environmentDocument
  @Environment(\.mosaicAxisBounds) private var parentBounds
  let badge: MosaicProductBadgeComponent
  let option: MosaicResolvedProductOption
  let selected: Bool
  let document: MosaicPaywallDocument
  let localization: MosaicLocalizationResolver
  @ObservedObject var model: MosaicPaywallModel
  let imageResolver: MosaicImageResolver
  /// A badge belongs to a card, and a card's selection is the selector's state,
  /// so the badge follows the same authored `selection` motion.
  let selectionMotion: MosaicSelectionMotion?

  private func borderColor(_ style: MosaicSelectionStateStyle) -> MosaicRenderedColor {
    style.border.color.rendered(in: document, role: .decoration)
  }

  var body: some View {
    MosaicSelectionStyledContent(
      styles: badge.styles,
      selected: selected,
      motion: selectionMotion,
      curve: selectionMotion.flatMap { document.resolvedMotionCurve($0.curve) },
      content: badgeBody
    )
  }

  private func badgeBody(style: MosaicSelectionStateStyle) -> some View {
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
          .strokeBorder(borderColor(style).color, lineWidth: style.border.width)
      }
      .mosaicStyleDiagnostics(borderColor(style).failure)
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
