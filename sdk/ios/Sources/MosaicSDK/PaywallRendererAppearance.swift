import AVFoundation
import SwiftUI

#if os(iOS)
  import UIKit
#elseif os(macOS)
  import AppKit
#endif

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
final class MosaicLoopingVideoModel: ObservableObject {
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
struct MosaicDecorativeVideoView<Fallback: View>: View {
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

struct MosaicAppearanceModifier: ViewModifier {
  @Environment(\.mosaicDocument) private var document
  let appearance: MosaicBoxAppearance?

  func body(content: Content) -> some View {
    let radius = appearance?.cornerRadius ?? 0
    let border = appearance?.border
    let borderColor = border?.color.rendered(in: document, role: .decoration)
    return
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
        if let border, let borderColor {
          RoundedRectangle(cornerRadius: radius, style: .continuous)
            .stroke(borderColor.color, lineWidth: border.width)
        }
      }
      .mosaicStyleDiagnostics(borderColor?.failure)
      .opacity(appearance?.opacity ?? 1)
      .mosaicClipShape(appearance?.clipContent == true, radius: radius)
      .mosaicShadow(appearance?.shadow)
  }
}

struct MosaicSizingModifier: ViewModifier {
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

struct MosaicShadowModifier: ViewModifier {
  @Environment(\.mosaicDocument) private var document
  let shadow: MosaicShadow?

  @ViewBuilder
  func body(content: Content) -> some View {
    if let document, let shadow, let resolved = document.resolvedShadow(shadow),
      case .value(let color, let x, let y, let blur) = resolved
    {
      let rendered = color.rendered(in: document, role: .decoration)
      content
        .shadow(color: rendered.color, radius: blur, x: x, y: y)
        .mosaicStyleDiagnostics(rendered.failure)
    } else if let shadow, case .token(let id) = shadow {
      // An authored shadow that no token defines is dropped, not silently
      // treated as "no shadow was authored".
      content.mosaicStyleDiagnostics(.unresolvedShadowToken(id))
    } else {
      content
    }
  }
}

extension View {
  @ViewBuilder
  func mosaicScreenAccessibilityLabel(_ label: String?) -> some View {
    if let label {
      accessibilityElement(children: .contain)
        .accessibilityLabel(Text(label))
    } else {
      self
    }
  }

  func mosaicPresentation(
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
  func mosaicSizing(_ sizing: MosaicBoxSizing?) -> some View {
    modifier(MosaicSizingModifier(sizing: sizing))
  }

  @ViewBuilder
  func mosaicWidth(_ width: MosaicWidthSizing?) -> some View {
    switch width {
    case .fill: frame(maxWidth: .infinity)
    case .fixed(let value): frame(width: value)
    case .content, .fit, .none: self
    }
  }

  @ViewBuilder
  func mosaicHeight(_ height: MosaicHeightSizing?) -> some View {
    switch height {
    case .fill: self
    case .fixed(let value): frame(height: value)
    case .content, .fit, .none: self
    }
  }

  @ViewBuilder
  func mosaicImageDimensions(_ image: MosaicImageComponent) -> some View {
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
  func mosaicStretchWidth(_ stretch: Bool) -> some View {
    if stretch { frame(maxWidth: .infinity) } else { self }
  }

  func mosaicShadow(_ shadow: MosaicShadow?) -> some View {
    modifier(MosaicShadowModifier(shadow: shadow))
  }

  @ViewBuilder
  func mosaicMediaContentMode(_ mode: MosaicImageContentMode) -> some View {
    switch mode {
    case .fit: scaledToFit()
    case .fill: scaledToFill()
    }
  }

  @ViewBuilder
  func mosaicClipShape(_ clip: Bool, radius: Double) -> some View {
    if clip {
      clipShape(RoundedRectangle(cornerRadius: radius, style: .continuous))
    } else {
      self
    }
  }

  @ViewBuilder
  func mosaicClipText(_ clip: Bool) -> some View {
    if clip { clipped() } else { self }
  }

  @ViewBuilder
  func mosaicDefaultButtonAppearance(
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
  func mosaicHeading(_ accessibility: MosaicTextAccessibility) -> some View {
    if accessibility.headingLevel != nil { accessibilityAddTraits(.isHeader) } else { self }
  }

  @ViewBuilder
  func mosaicTextAccessibilityLabel(
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
  func mosaicImageAccessibility(
    _ accessibility: MosaicImageAccessibility,
    localization: MosaicLocalizationResolver
  ) -> some View {
    switch accessibility {
    case .decorative: accessibilityHidden(true)
    case .informative(let label): accessibilityLabel(Text(localization.resolve(label)))
    }
  }

  @ViewBuilder
  func mosaicAccessibilityHint(_ hint: String?) -> some View {
    if let hint { accessibilityHint(Text(hint)) } else { self }
  }

  @ViewBuilder
  func mosaicSelected(_ selected: Bool) -> some View {
    if selected { accessibilityAddTraits(.isSelected) } else { self }
  }

  @ViewBuilder
  func mosaicBusyValue(_ value: String?) -> some View {
    if let value { accessibilityValue(Text(value)) } else { self }
  }
}

extension MosaicIconName {
  var systemName: String {
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
  var swiftUI: TextAlignment {
    switch self {
    case .start: .leading
    case .center: .center
    case .end: .trailing
    }
  }

  var frameAlignment: Alignment {
    switch self {
    case .start: .leading
    case .center: .center
    case .end: .trailing
    }
  }
}

extension MosaicFontWeight {
  var swiftUI: Font.Weight {
    switch self {
    case .regular: .regular
    case .medium: .medium
    case .semibold: .semibold
    case .bold: .bold
    }
  }
}

/// How an unresolvable color recovers.
///
/// The recovery differs by role on purpose. Invisible content is content loss,
/// so unresolvable content colors fall back to the primary content color, which
/// is legible on every system surface. Decoration recovers to transparent
/// instead: the parent surface still shows through, and painting an unauthored
/// opaque color over the layout is a worse failure than omitting it. Both roles
/// diagnose.
enum MosaicColorRole {
  case content
  case decoration

  var recoveryColor: Color {
    switch self {
    case .content: .primary
    case .decoration: .clear
    }
  }
}

struct MosaicRenderedColor {
  let color: Color
  let failure: MosaicStyleResolutionFailure?
}

extension MosaicColor {
  func swiftUI(in document: MosaicPaywallDocument?) -> Color {
    rendered(in: document, role: .decoration).color
  }

  /// Resolves this color for rendering and reports why, if it could not be
  /// resolved to the authored value.
  func rendered(in document: MosaicPaywallDocument?, role: MosaicColorRole) -> MosaicRenderedColor {
    let resolved = document?.resolvedColor(self) ?? self
    switch resolved {
    case .literal(let raw):
      guard let color = Self.literal(raw) else {
        return MosaicRenderedColor(
          color: role.recoveryColor, failure: .malformedColorLiteral(raw))
      }
      return MosaicRenderedColor(color: color, failure: nil)
    case .token(let id):
      return MosaicRenderedColor(color: role.recoveryColor, failure: .unresolvedColorToken(id))
    case .semantic(let semantic):
      return MosaicRenderedColor(color: Self.semantic(semantic), failure: nil)
    }
  }

  private static func literal(_ raw: String) -> Color? {
    guard raw.count == 9, raw.hasPrefix("#") else { return nil }
    guard let rgba = UInt64(raw.dropFirst(), radix: 16) else { return nil }
    return Color(
      red: Double((rgba >> 24) & 0xFF) / 255,
      green: Double((rgba >> 16) & 0xFF) / 255,
      blue: Double((rgba >> 8) & 0xFF) / 255,
      opacity: Double(rgba & 0xFF) / 255
    )
  }

  private static func semantic(_ semantic: MosaicSemanticColor) -> Color {
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
  }
}

/// Records style-resolution failures against the presentation model exactly
/// once per code and subject, mirroring the media-background diagnostic path.
struct MosaicStyleDiagnosticsModifier: ViewModifier {
  @EnvironmentObject private var model: MosaicPaywallModel
  let failures: [MosaicStyleResolutionFailure]

  @ViewBuilder
  func body(content: Content) -> some View {
    if failures.isEmpty {
      content
    } else {
      content.task {
        for failure in failures {
          model.recordRenderingDiagnosticOnce(failure.code, subjectID: failure.subjectID)
        }
      }
    }
  }
}

extension View {
  func mosaicStyleDiagnostics(_ failures: [MosaicStyleResolutionFailure]) -> some View {
    modifier(MosaicStyleDiagnosticsModifier(failures: failures))
  }

  func mosaicStyleDiagnostics(_ failures: MosaicStyleResolutionFailure?...) -> some View {
    modifier(MosaicStyleDiagnosticsModifier(failures: failures.compactMap { $0 }))
  }
}
