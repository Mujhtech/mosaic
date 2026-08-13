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
  /// The owning document. Without it no authored design token resolves, which
  /// is why this is threaded in rather than read from the environment default.
  let document: MosaicPaywallDocument
  let localization: MosaicLocalizationResolver
  let onSelect: () -> Void

  var body: some View {
    let background = style.background.rendered(in: document, role: .decoration)
    let border = style.border.color.rendered(in: document, role: .decoration)
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
        .fill(background.color)
    )
    .overlay {
      RoundedRectangle(cornerRadius: style.cornerRadius, style: .continuous)
        .stroke(border.color, lineWidth: style.border.width)
    }
    .mosaicStyleDiagnostics(background.failure, border.failure)
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
    let label = style.productLabelColor.rendered(in: document, role: .content)
    let price = style.runtimePriceColor.rendered(in: document, role: .content)
    let badgeText = style.badge.textColor.rendered(in: document, role: .content)
    let badgeBackground = style.badge.background.rendered(in: document, role: .decoration)
    let badgeBorder = style.badge.border.color.rendered(in: document, role: .decoration)
    return VStack(alignment: stackAlignment, spacing: 4) {
      Text(localization.resolve(option.reference.label))
        .font(.headline)
        .foregroundColor(label.color)
      if let badge = option.reference.badge {
        Text(localization.resolve(badge))
          .font(.caption.bold())
          .foregroundColor(badgeText.color)
          .padding(.top, style.badge.padding.top)
          .padding(.leading, style.badge.padding.start)
          .padding(.bottom, style.badge.padding.bottom)
          .padding(.trailing, style.badge.padding.end)
          .background(
            RoundedRectangle(cornerRadius: style.badge.cornerRadius, style: .continuous)
              .fill(badgeBackground.color)
          )
          .overlay {
            RoundedRectangle(cornerRadius: style.badge.cornerRadius, style: .continuous)
              .stroke(badgeBorder.color, lineWidth: style.badge.border.width)
          }
          .mosaicStyleDiagnostics(
            badgeText.failure, badgeBackground.failure, badgeBorder.failure)
      }
      if let period = option.product.localizedSubscriptionPeriod {
        Text(period)
          .font(.caption)
          .foregroundColor(price.color.opacity(0.82))
      }
    }
    .mosaicStyleDiagnostics(label.failure, price.failure)
  }

  private var price: some View {
    let rendered = style.runtimePriceColor.rendered(in: document, role: .content)
    return Text(option.product.localizedPrice)
      .font(.headline.monospacedDigit())
      .foregroundColor(rendered.color)
      .mosaicStyleDiagnostics(rendered.failure)
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
    // The authored, translated `mosaic.a11y.in_progress` string. A button with
    // no in-progress content announces no progress state, and an unresolvable
    // key announces nothing rather than an English literal.
    .mosaicBusyValue(
      busy && component.inProgressChildren != nil
        ? localization.resolve(reserved: .inProgress) : nil
    )
    .mosaicPresentation(
      appearance: component.appearance,
      sizing: component.sizing,
      outerInsets: component.outerInsets
    )
    .frame(minWidth: 44, minHeight: 44)
    // Button is the only component that may pulse, and at most one per screen
    // may do so. A pulsing button announces exactly what a static one does.
    .mosaicLoopMotion(component.motion, in: document)
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
      model.recordExternalURLAction(componentID: component.id)
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
struct MosaicSwitchView: View {
  @Environment(\.mosaicDocument) private var document
  let component: MosaicSwitchComponent
  let localization: MosaicLocalizationResolver
  @ObservedObject var model: MosaicPaywallModel

  var body: some View {
    let track = component.onTrackColor.rendered(in: document, role: .decoration)
    return Toggle(
      isOn: Binding(
        get: { model.switchValue(for: component.id) },
        set: { model.setSwitchValue($0, for: component.id) }
      )
    ) {
      MosaicStyledText(
        value: localization.resolve(component.label), typography: component.typography)
    }
    .toggleStyle(.switch)
    .tint(track.color)
    .mosaicStyleDiagnostics(track.failure)
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
        // The stored index is checked rather than subscripted directly: an
        // authored `initialPageIndex` past the last page must degrade, not trap
        // inside the host application.
        if let page = visiblePage {
          pageView(page)
        }
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

  /// The page the non-paged platforms show, or the first page when the stored
  /// index is out of range, or nothing when the carousel declares no pages.
  private var visiblePage: MosaicCarouselPage? {
    let index = selection.wrappedValue
    guard component.pages.indices.contains(index) else { return component.pages.first }
    return component.pages[index]
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
  @EnvironmentObject private var driver: MosaicMotionDriver
  let component: MosaicCountdownComponent
  let localization: MosaicLocalizationResolver
  @ObservedObject var model: MosaicPaywallModel

  /// The redraw cadence comes from the injected driver rather than from
  /// `TimelineView(.periodic(from: .now, by: 1))`.
  ///
  /// The countdown's *value* has always come from the injected clock; only its
  /// repaint schedule was wall-clock, and that made "what does it show one tick
  /// later" untestable. Observing the driver's tick count makes the cadence an
  /// injected input like everything else. The rounding of the remaining time is
  /// deliberately untouched here: that divergence is a separately tracked 0.3
  /// defect, and fixing it inside a 0.4 change would hide it.
  var body: some View {
    let resolution = MosaicCountdownText.resolution(
      component: component,
      now: model.currentDate(),
      completedText: localization.resolve(component.completedText)
    )
    return MosaicStyledText(value: resolution.text, typography: component.typography)
      .mosaicHeading(component.accessibility)
      .mosaicTextAccessibilityLabel(component.accessibility, localization: localization)
      .mosaicCountdownDiagnostic(resolution, componentID: component.id)
      .id(driver.tickCount)
      .mosaicPresentation(
        appearance: component.appearance,
        sizing: component.sizing,
        outerInsets: component.outerInsets
      )
      .task { await driver.runCadence() }
  }
}

/// What a countdown resolved to at a point in time.
///
/// `invalidEndsAt` exists because the 0.3 reader policy maps
/// `completedCountdown` to `showLocalizedCompletedText`, and an `endsAt` that
/// cannot be parsed is a validation failure, not a completion. Presenting a
/// malformed date as "offer expired" states a commercial fact the document
/// never authored.
public enum MosaicCountdownResolution: Sendable, Equatable {
  case remaining(String)
  case completed(String)
  case invalidEndsAt

  public var text: String {
    switch self {
    case .remaining(let value), .completed(let value): value
    case .invalidEndsAt: ""
    }
  }
}

public enum MosaicCountdownText {
  /// Backwards-compatible text-only resolution. An unparseable `endsAt` renders
  /// nothing rather than claiming the offer completed.
  public static func resolve(
    component: MosaicCountdownComponent,
    now: Date,
    completedText: String
  ) -> String {
    resolution(component: component, now: now, completedText: completedText).text
  }

  public static func resolution(
    component: MosaicCountdownComponent,
    now: Date,
    completedText: String
  ) -> MosaicCountdownResolution {
    guard let end = endDate(component.endsAt) else { return .invalidEndsAt }
    let remaining = max(0, Int(end.timeIntervalSince(now).rounded(.down)))
    guard remaining > 0 else { return .completed(completedText) }

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
    return .remaining(values.joined(separator: " "))
  }

  /// The one definition of a parseable `endsAt`, shared with the semantic
  /// validator that rejects the document outright. Keeping a second, more
  /// lenient parser here would let the renderer disagree with the contract
  /// about what a valid countdown is.
  private static func endDate(_ value: String) -> Date? {
    MosaicProtocolV03Semantics.canonicalDate(value)
  }
}

extension View {
  @ViewBuilder
  func mosaicCountdownDiagnostic(
    _ resolution: MosaicCountdownResolution,
    componentID: String
  ) -> some View {
    if case .invalidEndsAt = resolution {
      mosaicStyleDiagnostics(
        MosaicStyleResolutionFailure(
          code: "countdown_ends_at_invalid", subjectID: componentID))
    } else {
      self
    }
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

/// What a declared video background resolves to, decided before any view exists.
///
/// Extracted from the view because "no player is constructed" is a claim about
/// this decision and nothing else can state it: the absence of a diagnostic is
/// equally true of a video that plays, so a test asserting only that passes with
/// the reduced-motion guard deleted.
enum MosaicVideoBackgroundPresentation: Equatable {
  /// A player is constructed and plays `url`.
  case play(url: URL)
  /// No player is constructed. The declared poster is drawn when one is
  /// declared, and the declared fallback colour otherwise.
  ///
  /// `recordsUnavailable` separates the two reasons for arriving here: media the
  /// host could not resolve, which diagnoses, and a user preference, which does
  /// not.
  case still(posterID: String?, recordsUnavailable: Bool)

  /// The one code both paths record, so an operator reading diagnostics cannot
  /// infer from the wording whether the video was suppressed or attempted. The
  /// customer's accessibility settings are not something a diagnostic feed should
  /// disclose, and "this asset is broken" is the same fact either way.
  static let unavailableDiagnosticCode = "media_video_background_unavailable"

  /// - Parameter resolvedSource: the asset's playable URL, or `nil` when the host
  ///   could not resolve one. `nil` means the document declares no such asset, or
  ///   declares a *bundled* one whose key the host's resolver does not map —
  ///   both knowable by lookup alone. A *remote* asset always resolves to its
  ///   URL here, because whether that URL actually loads is knowable only by
  ///   fetching it, and fetching is the playback a suppressed video must not do.
  static func resolve(
    resolvedSource: URL?,
    posterID: String?,
    schemaVersion: String?,
    accessibility: MosaicMotionAccessibility
  ) -> MosaicVideoBackgroundPresentation {
    // ADR-0027 ruling 3: the reduced-motion fix ships as specified `0.4`
    // behaviour, not as a `0.3` defect patch. A `0.3` document therefore keeps
    // `0.3`'s behaviour — the live exposure stays open until `0.4` lands and is
    // accepted, and is tracked as such rather than closed here. Flutter draws
    // the same version gate.
    let reducedMotionStops =
      accessibility.prefersReducedMotion && schemaVersion == mosaicMotionProtocolVersion
    // Video Autoplay is Apple's own, narrower switch rather than a protocol
    // rule, so it is honoured on every document version: a user who turned it
    // off meant it, and a `0.3` document is not a licence to ignore it.
    let autoplayStops = !accessibility.allowsVideoAutoplay
    // The poster-then-fallback order is the one the existing missing-media
    // policy already uses, reused deliberately rather than introducing a fourth
    // outcome.
    //
    // Unavailability is a fact about the media rather than about the preference,
    // so a source the host cannot resolve is reported whether or not it would
    // have been allowed to play: an operator must be able to see a broken asset
    // without first ruling out every viewer's accessibility settings, and
    // Compose has always recorded it here. The converse holds too — a suppressed
    // video whose source resolves diagnoses nothing, because nothing is wrong.
    //
    // The line sits exactly where knowability does. Everything diagnosed on this
    // path is settled by lookup; a remote URL that would have 404'd is diagnosed
    // on the playing path alone, by the player that actually tried.
    guard !reducedMotionStops, !autoplayStops, let resolvedSource else {
      return .still(posterID: posterID, recordsUnavailable: resolvedSource == nil)
    }
    return .play(url: resolvedSource)
  }
}

@MainActor
struct MosaicBackgroundView: View {
  @Environment(\.mosaicDocument) private var document
  @Environment(\.mosaicImageResolver) private var imageResolver
  @Environment(\.mosaicVideoResolver) private var videoResolver
  @Environment(\.mosaicMotionAccessibility) private var motionAccessibility
  @EnvironmentObject private var model: MosaicPaywallModel

  let background: MosaicBackground

  @ViewBuilder
  var body: some View {
    if let document {
      let resolution = document.renderableBackground(background)
      Group {
        if let resolved = resolution.background {
          content(resolved, document: document)
        } else {
          Color.clear
        }
      }
      .accessibilityHidden(true)
      .mosaicStyleDiagnostics(resolution.failures)
    } else {
      // Only reachable outside a rendered document, where no design token can
      // resolve. Diagnose rather than paint an unexplained empty surface.
      Color.clear
        .accessibilityHidden(true)
        .mosaicStyleDiagnostics(
          MosaicStyleResolutionFailure(
            code: "style_background_document_unavailable", subjectID: "background"))
    }
  }

  @ViewBuilder
  private func content(_ background: MosaicBackground, document: MosaicPaywallDocument) -> some View
  {
    switch background {
    case .color(let color):
      let rendered = color.rendered(in: document, role: .decoration)
      rendered.color.mosaicStyleDiagnostics(rendered.failure)
    case .linearGradient(let angle, let stops):
      let points = MosaicGradientGeometry.endpoints(angle: angle)
      let rendered = stops.map { $0.color.rendered(in: document, role: .decoration) }
      LinearGradient(
        stops: zip(stops, rendered).map { .init(color: $1.color, location: $0.position) },
        startPoint: UnitPoint(x: points.start.x, y: points.start.y),
        endPoint: UnitPoint(x: points.end.x, y: points.end.y)
      )
      .mosaicStyleDiagnostics(rendered.compactMap(\.failure))
    case .radialGradient(let center, let radius, let stops):
      let rendered = stops.map { $0.color.rendered(in: document, role: .decoration) }
      GeometryReader { geometry in
        RadialGradient(
          stops: zip(stops, rendered).map { .init(color: $1.color, location: $0.position) },
          center: UnitPoint(x: center.x, y: center.y),
          startRadius: 0,
          endRadius: max(geometry.size.width, geometry.size.height) * radius
        )
      }
      .mosaicStyleDiagnostics(rendered.compactMap(\.failure))
    case .image(let assetID, let mode, let fallback):
      let rendered = fallback.rendered(in: document, role: .decoration)
      mediaImage(
        assetID: assetID,
        mode: mode,
        fallback: rendered.color,
        diagnostic: "media_image_background_unavailable"
      )
      .mosaicStyleDiagnostics(rendered.failure)
    case .video(let assetID, let posterID, let mode, let fallback):
      let rendered = fallback.rendered(in: document, role: .decoration)
      video(
        assetID: assetID,
        posterID: posterID,
        mode: mode,
        fallback: rendered.color
      )
      .mosaicStyleDiagnostics(rendered.failure)
    case .token(let id):
      // Unreachable after `renderableBackground`, which reports unresolved
      // background tokens itself. Diagnosing here keeps the arm honest rather
      // than painting nothing silently.
      Color.clear.mosaicStyleDiagnostics(.unresolvedBackgroundToken(id))
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
    // Resolvable by lookup alone: a bundled key the host does not map yields
    // nothing, while a remote asset always yields its URL — whether that URL
    // loads is the player's question, not this one's.
    let resolvedSource = document?.assets.first(where: { $0.id == assetID })
      .flatMap { asset -> URL? in
        switch asset.source {
        case .bundled(let key): videoResolver.url(for: key)
        case .remote(let url): url
        }
      }
    // No frame of a stopped video is shown, playback is not started and paused,
    // and no control is offered: the `still` arm constructs no player at all.
    switch MosaicVideoBackgroundPresentation.resolve(
      resolvedSource: resolvedSource,
      posterID: posterID,
      schemaVersion: document?.schemaVersion,
      accessibility: motionAccessibility
    ) {
    case .play(let url):
      MosaicDecorativeVideoView(url: url, contentMode: mode) {
        model.recordRenderingDiagnosticOnce(
          MosaicVideoBackgroundPresentation.unavailableDiagnosticCode, subjectID: assetID)
      } fallback: {
        posterOrFallback(posterID: posterID, mode: mode, fallback: fallback)
      }
    case .still(let posterID, let recordsUnavailable):
      posterOrFallback(posterID: posterID, mode: mode, fallback: fallback)
        .task {
          guard recordsUnavailable else { return }
          model.recordRenderingDiagnosticOnce(
            MosaicVideoBackgroundPresentation.unavailableDiagnosticCode, subjectID: assetID)
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
