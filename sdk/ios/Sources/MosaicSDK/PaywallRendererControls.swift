import AVFoundation
import SwiftUI

#if os(iOS)
  import UIKit
#elseif os(macOS)
  import AppKit
#endif

struct MosaicLegacyProductCardView: View {
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
struct MosaicButtonView: View {
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
struct MosaicButtonContentView: View {
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
struct MosaicPurchaseButtonView: View {
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
struct MosaicRestoreButtonView: View {
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
struct MosaicCloseButtonView: View {
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

struct MosaicLegalTextView: View {
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
struct MosaicSwitchView: View {
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
struct MosaicCarouselView: View {
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
struct MosaicCountdownView: View {
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

enum MosaicDefaultButtonKind { case purchase, secondary }

struct MosaicAxisBounds: Equatable, Sendable {
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

struct MosaicDocumentEnvironmentKey: EnvironmentKey {
  static let defaultValue: MosaicPaywallDocument? = nil
}

struct MosaicImageResolverEnvironmentKey: EnvironmentKey {
  static let defaultValue = MosaicImageResolver.missing
}

struct MosaicVideoResolverEnvironmentKey: EnvironmentKey {
  static let defaultValue = MosaicVideoResolver.missing
}

struct MosaicAxisBoundsEnvironmentKey: EnvironmentKey {
  static let defaultValue = MosaicAxisBounds(width: true, height: false)
}

extension EnvironmentValues {
  var mosaicDocument: MosaicPaywallDocument? {
    get { self[MosaicDocumentEnvironmentKey.self] }
    set { self[MosaicDocumentEnvironmentKey.self] = newValue }
  }

  @MainActor var mosaicImageResolver: MosaicImageResolver {
    get { self[MosaicImageResolverEnvironmentKey.self] }
    set { self[MosaicImageResolverEnvironmentKey.self] = newValue }
  }

  @MainActor var mosaicVideoResolver: MosaicVideoResolver {
    get { self[MosaicVideoResolverEnvironmentKey.self] }
    set { self[MosaicVideoResolverEnvironmentKey.self] = newValue }
  }

  var mosaicAxisBounds: MosaicAxisBounds {
    get { self[MosaicAxisBoundsEnvironmentKey.self] }
    set { self[MosaicAxisBoundsEnvironmentKey.self] = newValue }
  }
}

@MainActor
struct MosaicBackgroundView: View {
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

