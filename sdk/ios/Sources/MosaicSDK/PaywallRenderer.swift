import SwiftUI

#if os(iOS)
import UIKit
#elseif os(macOS)
import AppKit
#endif

@MainActor
public struct MosaicImageResolver {
  private let resolver: @MainActor (String) -> Image?

  public init(_ resolver: @escaping @MainActor (String) -> Image?) {
    self.resolver = resolver
  }

  public func image(for key: String) -> Image? { resolver(key) }

  public static let missing = MosaicImageResolver { _ in nil }
}

/// Native SwiftUI renderer for validated Mosaic Protocol 0.1 and 0.2 documents.
/// The host application retains ownership of sheet or full-screen dismissal.
@MainActor
public struct MosaicPaywall: View {
  @StateObject private var model: MosaicPaywallModel
  private let imageResolver: MosaicImageResolver

  public init(
    document: MosaicPaywallDocument,
    requestedLocale: String? = nil,
    purchaseProvider: any MosaicPurchaseProvider,
    imageResolver: MosaicImageResolver = .missing,
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
  }

  public init(
    model: @autoclosure @escaping () -> MosaicPaywallModel,
    imageResolver: MosaicImageResolver = .missing
  ) {
    _model = StateObject(wrappedValue: model())
    self.imageResolver = imageResolver
  }

  public var body: some View {
    ScrollView(.vertical, showsIndicators: model.document.layout.showsIndicators) {
      MosaicStackView(
        stack: model.document.layout.content,
        document: model.document,
        localization: model.localization,
        model: model,
        imageResolver: imageResolver
      )
    }
    .background(model.document.layout.background?.swiftUI ?? Color.clear)
    .environment(\.layoutDirection, swiftUILayoutDirection)
    .environment(\.locale, Locale(identifier: model.localization.resolvedLocale.effectiveLocale))
    .task { await model.prepare() }
  }

  private var swiftUILayoutDirection: LayoutDirection {
    model.localization.resolvedLocale.direction == .rightToLeft ? .rightToLeft : .leftToRight
  }
}

@MainActor
private struct MosaicStackView: View {
  let stack: MosaicStack
  let document: MosaicPaywallDocument
  let localization: MosaicLocalizationResolver
  @ObservedObject var model: MosaicPaywallModel
  let imageResolver: MosaicImageResolver

  @ViewBuilder
  var body: some View {
    if model.isVisible(stack.visibility) {
      stackContent
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
          { Spacer(minLength: stack.gap) }
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
          { Spacer(minLength: stack.gap) }
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
      imageResolver: imageResolver
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
    stack.direction == .vertical && stack.crossAxisAlignment == .stretch ? .infinity : nil
  }

  private var stackFrameAlignment: Alignment {
    switch stack.crossAxisAlignment {
    case .start, .stretch: .leading
    case .center: .center
    case .end: .trailing
    }
  }
}

@MainActor
private struct MosaicNodeView: View {
  let node: MosaicNode
  let document: MosaicPaywallDocument
  let localization: MosaicLocalizationResolver
  @ObservedObject var model: MosaicPaywallModel
  let imageResolver: MosaicImageResolver

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
          imageResolver: imageResolver
        )
      case .text(let component):
        MosaicTextView(component: component, localization: localization)
      case .image(let component):
        MosaicImageView(
          component: component,
          asset: document.assets.first { $0.id == component.assetId },
          localization: localization,
          resolver: imageResolver
        )
      case .featureList(let component):
        MosaicFeatureListView(component: component, localization: localization)
      case .productSelector(let component):
        MosaicProductSelectorView(component: component, localization: localization, model: model)
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
  let value: String
  let typography: MosaicTypography

  var body: some View {
    Text(value)
      .font(.system(size: typography.fontSize, weight: typography.weight.swiftUI))
      .foregroundColor(typography.color.swiftUI)
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

  var body: some View {
    MosaicStyledText(value: localization.resolve(component.value), typography: component.typography)
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
        sizing: nil,
        outerInsets: component.outerInsets
      )
  }

  @ViewBuilder
  private var imageContent: some View {
    if let asset, let image = resolver.image(for: asset.source.key) {
      switch component.contentMode {
      case .fit: image.resizable().scaledToFit()
      case .fill: image.resizable().scaledToFill()
      }
    } else {
      ZStack {
        Color.secondary.opacity(0.12)
        Text(asset.map { localization.resolve($0.fallback.value) } ?? "")
          .font(.body)
          .foregroundColor(.secondary)
          .multilineTextAlignment(.center)
          .padding()
      }
    }
  }
}

private struct MosaicFeatureListView: View {
  let component: MosaicFeatureListComponent
  let localization: MosaicLocalizationResolver

  var body: some View {
    VStack(alignment: .leading, spacing: component.gap) {
      ForEach(component.items) { item in
        HStack(alignment: .firstTextBaseline, spacing: 10) {
          Image(systemName: "checkmark.circle.fill")
            .foregroundColor(component.markerColor.swiftUI)
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
  let component: MosaicProductSelectorComponent
  let localization: MosaicLocalizationResolver
  @ObservedObject var model: MosaicPaywallModel

  @ViewBuilder
  var body: some View {
    selectorContent
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
      HStack(alignment: .top, spacing: component.gap) {
        optionViews(options)
      }
    } else {
      VStack(alignment: .leading, spacing: component.gap) {
        optionViews(options)
      }
    }
  }

  @ViewBuilder
  private func optionViews(_ options: [MosaicResolvedProductOption]) -> some View {
    ForEach(options) { option in
      let selected = model.selectedProductReferenceID(for: component.id) == option.reference.id
      MosaicProductCardView(
        option: option,
        selected: selected,
        style: selected
          ? component.cardStyles.selected.resolving(component.cardStyles.defaultStyle)
          : component.cardStyles.defaultStyle,
        localization: localization,
        onSelect: { model.selectProduct(referenceID: option.reference.id, in: component.id) }
      )
      .frame(maxWidth: component.direction == .horizontal ? .infinity : nil)
    }
  }
}

private struct MosaicProductCardView: View {
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
      MosaicStyledText(value: localization.resolve(component.label), typography: component.typography)
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
      MosaicStyledText(value: localization.resolve(component.label), typography: component.typography)
    }
    .toggleStyle(.switch)
    .tint(component.onTrackColor.swiftUI)
    .accessibilityLabel(Text(localization.resolve(component.accessibility.label)))
    .mosaicAccessibilityHint(component.accessibility.hint.map(localization.resolve))
    .mosaicPresentation(
      appearance: component.appearance,
      sizing: nil,
      outerInsets: component.outerInsets
    )
  }
}

@MainActor
private struct MosaicCarouselView: View {
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
      imageResolver: imageResolver
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

private struct MosaicAppearanceModifier: ViewModifier {
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
          RoundedRectangle(cornerRadius: radius, style: .continuous)
            .fill(background.swiftUI)
        }
      }
      .overlay {
        if let border = appearance?.border {
          RoundedRectangle(cornerRadius: radius, style: .continuous)
            .stroke(border.color.swiftUI, lineWidth: border.width)
        }
      }
      .opacity(appearance?.opacity ?? 1)
      .mosaicClipShape(appearance?.clipContent == true, radius: radius)
  }
}

extension View {
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
    if let sizing {
      mosaicWidth(sizing.width).mosaicHeight(sizing.height)
    } else {
      self
    }
  }

  @ViewBuilder
  fileprivate func mosaicWidth(_ width: MosaicWidthSizing?) -> some View {
    switch width {
    case .fill: frame(maxWidth: .infinity)
    case .fixed(let value): frame(width: value)
    case .content, .none: self
    }
  }

  @ViewBuilder
  fileprivate func mosaicHeight(_ height: MosaicHeightSizing?) -> some View {
    switch height {
    case .fixed(let value): frame(height: value)
    case .content, .none: self
    }
  }

  @ViewBuilder
  fileprivate func mosaicImageDimensions(_ image: MosaicImageComponent) -> some View {
    let widthApplied = mosaicWidth(image.width)
    if let ratio = image.aspectRatio {
      widthApplied.aspectRatio(ratio, contentMode: .fit)
    } else if let height = image.height {
      widthApplied.frame(height: height)
    } else {
      widthApplied
    }
  }

  @ViewBuilder
  fileprivate func mosaicStretchWidth(_ stretch: Bool) -> some View {
    if stretch { frame(maxWidth: .infinity) } else { self }
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
    switch self {
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
    }
  }
}
