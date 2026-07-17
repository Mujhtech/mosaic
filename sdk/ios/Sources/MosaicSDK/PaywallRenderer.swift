import SwiftUI

@MainActor
public struct MosaicImageResolver {
  private let resolver: @MainActor (String) -> Image?

  public init(_ resolver: @escaping @MainActor (String) -> Image?) {
    self.resolver = resolver
  }

  public func image(for key: String) -> Image? {
    resolver(key)
  }

  /// Explicitly demonstrates the protocol placeholder path.
  public static let missing = MosaicImageResolver { _ in nil }
}

/// Native SwiftUI renderer for one validated Mosaic Protocol 0.1 document.
///
/// The view reports terminal results but never dismisses its host. Applications
/// retain ownership of `sheet` or `fullScreenCover` dismissal.
@MainActor
public struct MosaicPaywall: View {
  @StateObject private var model: MosaicPaywallModel
  private let imageResolver: MosaicImageResolver

  public init(
    document: MosaicPaywallDocument,
    requestedLocale: String? = nil,
    purchaseProvider: any MosaicPurchaseProvider,
    imageResolver: MosaicImageResolver = .missing,
    onInteraction: @escaping @MainActor (MosaicInteractionOutcome) -> Void = { _ in },
    onResult: @escaping @MainActor (MosaicPresentationResult) -> Void
  ) {
    _model = StateObject(
      wrappedValue: MosaicPaywallModel(
        document: document,
        requestedLocale: requestedLocale,
        purchaseProvider: purchaseProvider,
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
      MosaicVerticalStackView(
        stack: model.document.layout.content,
        document: model.document,
        localization: model.localization,
        model: model,
        imageResolver: imageResolver
      )
    }
    .environment(\.layoutDirection, swiftUILayoutDirection)
    .environment(
      \.locale,
      Locale(identifier: model.localization.resolvedLocale.effectiveLocale)
    )
    .task {
      await model.prepare()
    }
  }

  private var swiftUILayoutDirection: LayoutDirection {
    model.localization.resolvedLocale.direction == .rightToLeft ? .rightToLeft : .leftToRight
  }
}

@MainActor
private struct MosaicVerticalStackView: View {
  let stack: MosaicVerticalStack
  let document: MosaicPaywallDocument
  let localization: MosaicLocalizationResolver
  let model: MosaicPaywallModel
  let imageResolver: MosaicImageResolver

  var body: some View {
    VStack(alignment: stackAlignment, spacing: stack.spacing) {
      ForEach(stack.children) { node in
        MosaicNodeView(
          node: node,
          document: document,
          localization: localization,
          model: model,
          imageResolver: imageResolver
        )
        .mosaicStretch(stack.horizontalAlignment == .stretch)
        .id(node.id)
      }
    }
    .frame(maxWidth: .infinity, alignment: frameAlignment)
    .padding(.top, stack.padding.top)
    .padding(.leading, stack.padding.start)
    .padding(.bottom, stack.padding.bottom)
    .padding(.trailing, stack.padding.end)
  }

  private var stackAlignment: HorizontalAlignment {
    switch stack.horizontalAlignment {
    case .start, .stretch: .leading
    case .center: .center
    case .end: .trailing
    }
  }

  private var frameAlignment: Alignment {
    switch stack.horizontalAlignment {
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
  let model: MosaicPaywallModel
  let imageResolver: MosaicImageResolver

  @ViewBuilder
  var body: some View {
    switch node {
    case .verticalStack(let stack):
      MosaicVerticalStackView(
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
      MosaicProductSelectorView(
        component: component,
        localization: localization,
        model: model
      )
    case .purchaseButton(let component):
      MosaicPurchaseButtonView(
        component: component,
        localization: localization,
        model: model
      )
    case .restoreButton(let component):
      MosaicRestoreButtonView(
        component: component,
        localization: localization,
        model: model
      )
    case .closeButton(let component):
      MosaicCloseButtonView(
        component: component,
        localization: localization,
        model: model
      )
    case .legalText(let component):
      MosaicLegalTextView(component: component, localization: localization)
    }
  }
}

private struct MosaicTextView: View {
  let component: MosaicTextComponent
  let localization: MosaicLocalizationResolver

  var body: some View {
    Text(localization.resolve(component.value))
      .font(font)
      .multilineTextAlignment(component.alignment.swiftUI)
      .frame(maxWidth: .infinity, alignment: component.alignment.frameAlignment)
      .fixedSize(horizontal: false, vertical: true)
      .mosaicHeading(component.accessibility)
  }

  private var font: Font {
    switch component.style {
    case .title: .title.bold()
    case .body: .body
    case .caption: .caption
    }
  }
}

@MainActor
private struct MosaicImageView: View {
  let component: MosaicImageComponent
  let asset: MosaicImageAsset?
  let localization: MosaicLocalizationResolver
  let resolver: MosaicImageResolver

  var body: some View {
    Group {
      if let asset, let image = resolver.image(for: asset.source.key) {
        switch component.contentMode {
        case .fit:
          image.resizable().scaledToFit()
        case .fill:
          image.resizable().scaledToFill()
        }
      } else {
        placeholder
      }
    }
    .frame(maxWidth: .infinity)
    .aspectRatio(component.aspectRatio, contentMode: .fit)
    .clipped()
    .mosaicImageAccessibility(component.accessibility, localization: localization)
  }

  private var placeholder: some View {
    ZStack {
      Color.secondary.opacity(0.12)
      Text(asset.map { localization.resolve($0.fallback.value) } ?? "")
        .font(.body)
        .foregroundStyle(.secondary)
        .multilineTextAlignment(.center)
        .padding()
    }
  }
}

private struct MosaicFeatureListView: View {
  let component: MosaicFeatureListComponent
  let localization: MosaicLocalizationResolver

  var body: some View {
    VStack(alignment: .leading, spacing: component.itemSpacing) {
      ForEach(component.items) { item in
        HStack(alignment: .firstTextBaseline, spacing: 10) {
          Image(systemName: "checkmark.circle.fill")
            .foregroundStyle(.tint)
            .accessibilityHidden(true)
          Text(localization.resolve(item.text))
            .fixedSize(horizontal: false, vertical: true)
        }
        .accessibilityElement(children: .combine)
      }
    }
    .frame(maxWidth: .infinity, alignment: .leading)
    .accessibilityElement(children: .contain)
    .accessibilityLabel(Text(localization.resolve(component.accessibility.label)))
    .mosaicAccessibilityHint(component.accessibility.hint.map(localization.resolve))
  }
}

@MainActor
private struct MosaicProductSelectorView: View {
  let component: MosaicProductSelectorComponent
  let localization: MosaicLocalizationResolver
  @ObservedObject var model: MosaicPaywallModel

  var body: some View {
    VStack(alignment: .leading, spacing: component.itemSpacing) {
      let options = model.availableOptions(for: component)
      if options.isEmpty {
        Text(localization.resolve(component.unavailableFallback.message))
          .foregroundStyle(.secondary)
          .frame(maxWidth: .infinity, alignment: .leading)
          .fixedSize(horizontal: false, vertical: true)
      } else {
        ForEach(options) { option in
          let selected = model.selectedProductReferenceID(for: component.id) == option.reference.id
          Button {
            model.selectProduct(referenceID: option.reference.id, in: component.id)
          } label: {
            HStack(alignment: .center, spacing: 12) {
              VStack(alignment: .leading, spacing: 4) {
                HStack(spacing: 8) {
                  Text(localization.resolve(option.reference.label))
                    .font(.headline)
                  if let badge = option.reference.badge {
                    Text(localization.resolve(badge))
                      .font(.caption.bold())
                      .padding(.horizontal, 7)
                      .padding(.vertical, 3)
                      .background(.tint.opacity(0.14), in: Capsule())
                  }
                }
                if let period = option.product.localizedSubscriptionPeriod {
                  Text(period)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                }
              }
              Spacer(minLength: 12)
              Text(option.product.localizedPrice)
                .font(.headline.monospacedDigit())
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(14)
            .contentShape(Rectangle())
          }
          .buttonStyle(.plain)
          .background(
            RoundedRectangle(cornerRadius: 14, style: .continuous)
              .fill(selected ? Color.accentColor.opacity(0.12) : Color.secondary.opacity(0.07))
          )
          .overlay {
            RoundedRectangle(cornerRadius: 14, style: .continuous)
              .stroke(selected ? Color.accentColor : Color.secondary.opacity(0.25), lineWidth: 2)
          }
          .accessibilityElement(children: .ignore)
          .accessibilityLabel(Text(localization.resolve(option.reference.label)))
          .accessibilityValue(Text(accessibilityValue(option)))
          .mosaicSelected(selected)
        }
      }
    }
    .frame(maxWidth: .infinity, alignment: .leading)
    .accessibilityElement(children: .contain)
    .accessibilityLabel(Text(localization.resolve(component.accessibility.label)))
    .mosaicAccessibilityHint(component.accessibility.hint.map(localization.resolve))
  }

  private func accessibilityValue(_ option: MosaicResolvedProductOption) -> String {
    let parts: [String?] = [
      option.reference.badge.map(localization.resolve),
      option.product.localizedPrice,
      option.product.localizedSubscriptionPeriod,
    ]
    return parts.compactMap { $0 }
      .joined(separator: ", ")
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
      Text(localization.resolve(busy ? component.inProgressLabel : component.label))
        .font(.headline)
        .frame(maxWidth: .infinity)
        .padding(.vertical, 14)
    }
    .buttonStyle(.borderedProminent)
    .disabled(!model.isPurchaseEnabled(component))
    .accessibilityLabel(Text(localization.resolve(component.accessibility.label)))
    .mosaicAccessibilityHint(component.accessibility.hint.map(localization.resolve))
    .mosaicBusyValue(busy ? localization.resolve(component.inProgressLabel) : nil)
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
      Text(localization.resolve(busy ? component.inProgressLabel : component.label))
        .frame(maxWidth: .infinity)
        .padding(.vertical, 10)
    }
    .buttonStyle(.bordered)
    .disabled(!model.isRestoreEnabled(component))
    .accessibilityLabel(Text(localization.resolve(component.accessibility.label)))
    .mosaicAccessibilityHint(component.accessibility.hint.map(localization.resolve))
    .mosaicBusyValue(busy ? localization.resolve(component.inProgressLabel) : nil)
  }
}

@MainActor
private struct MosaicCloseButtonView: View {
  let component: MosaicCloseButtonComponent
  let localization: MosaicLocalizationResolver
  @ObservedObject var model: MosaicPaywallModel

  var body: some View {
    Button(localization.resolve(component.label)) {
      model.close(using: component)
    }
    .buttonStyle(.bordered)
    .accessibilityLabel(Text(localization.resolve(component.accessibility.label)))
    .mosaicAccessibilityHint(component.accessibility.hint.map(localization.resolve))
  }
}

private struct MosaicLegalTextView: View {
  let component: MosaicLegalTextComponent
  let localization: MosaicLocalizationResolver

  var body: some View {
    Text(localization.resolve(component.value))
      .font(.footnote)
      .foregroundStyle(.secondary)
      .multilineTextAlignment(component.alignment.swiftUI)
      .frame(maxWidth: .infinity, alignment: component.alignment.frameAlignment)
      .fixedSize(horizontal: false, vertical: true)
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

extension View {
  @ViewBuilder
  fileprivate func mosaicStretch(_ stretch: Bool) -> some View {
    if stretch {
      frame(maxWidth: .infinity)
    } else {
      self
    }
  }

  @ViewBuilder
  fileprivate func mosaicHeading(_ accessibility: MosaicTextAccessibility) -> some View {
    switch accessibility {
    case .text:
      self
    case .heading:
      accessibilityAddTraits(.isHeader)
    }
  }

  @ViewBuilder
  fileprivate func mosaicImageAccessibility(
    _ accessibility: MosaicImageAccessibility,
    localization: MosaicLocalizationResolver
  ) -> some View {
    switch accessibility {
    case .decorative:
      accessibilityHidden(true)
    case .informative(let label):
      accessibilityLabel(Text(localization.resolve(label)))
    }
  }

  @ViewBuilder
  fileprivate func mosaicAccessibilityHint(_ hint: String?) -> some View {
    if let hint {
      accessibilityHint(Text(hint))
    } else {
      self
    }
  }

  @ViewBuilder
  fileprivate func mosaicSelected(_ selected: Bool) -> some View {
    if selected {
      accessibilityAddTraits(.isSelected)
    } else {
      self
    }
  }

  @ViewBuilder
  fileprivate func mosaicBusyValue(_ value: String?) -> some View {
    if let value {
      accessibilityValue(Text(value))
    } else {
      self
    }
  }
}
