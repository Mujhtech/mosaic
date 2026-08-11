import Foundation
import SwiftUI

#if canImport(UIKit)
  import UIKit
#endif

/// The time authority for everything that moves.
///
/// The renderer never reads a wall clock of its own. It asks the driver, and the
/// driver is injected exactly as `MosaicPaywallModel`'s clock is, for the same
/// reason: a value that comes from the platform cannot be asserted against.
///
/// Two modes, and the difference is deliberate rather than incidental:
///
/// - **Platform.** `elapsedMilliseconds` is `nil`, and SwiftUI owns the frame
///   timeline — `timingCurve` for the two one-shot primitives, a
///   `TimelineView(.animation)` clock for the bounded pulse. The values still
///   come from `MosaicMotionResolver`, so the animated path and the conformance
///   path cannot disagree.
/// - **Controlled.** `elapsedMilliseconds` is the exact instant to render, and
///   nothing schedules anything. This is how tests drive motion without a
///   scheduler, and it is the only way the SDK can be asked "what are you
///   showing at t = 120 ms?" and answer deterministically.
///
/// `isEnabled` is separate from either. A disabled driver renders the terminal
/// state everywhere, which by the contract's terminal-state rule *is* the static
/// rendering — so every existing golden is captured with `.disabled()` and no
/// baseline moves when motion lands.
@MainActor
public final class MosaicMotionDriver: ObservableObject {
  /// Whether motion plays at all. A disabled driver is the `renderWithoutMotion`
  /// enhancement tier expressed at the renderer boundary.
  public let isEnabled: Bool

  /// The instant to render, in whole milliseconds since this driver's origin, or
  /// `nil` when the platform owns the timeline.
  @Published public private(set) var elapsedMilliseconds: Int?

  /// Bumped on every advance and on every cadence tick. Views that recompute
  /// from a clock — the Countdown — observe this rather than a wall clock of
  /// their own.
  @Published public private(set) var tickCount = 0

  private init(isEnabled: Bool, elapsedMilliseconds: Int?) {
    self.isEnabled = isEnabled
    self.elapsedMilliseconds = elapsedMilliseconds
  }

  /// The production driver: SwiftUI schedules, the contract supplies the values.
  public static func platform(isEnabled: Bool = true) -> MosaicMotionDriver {
    MosaicMotionDriver(isEnabled: isEnabled, elapsedMilliseconds: nil)
  }

  /// A driver that plays nothing. Every node renders its terminal state, which
  /// is its static rendering.
  public static func disabled() -> MosaicMotionDriver {
    MosaicMotionDriver(isEnabled: false, elapsedMilliseconds: nil)
  }

  /// A driver whose time the caller sets.
  public static func controlled(
    elapsedMilliseconds: Int = 0,
    isEnabled: Bool = true
  ) -> MosaicMotionDriver {
    MosaicMotionDriver(
      isEnabled: isEnabled, elapsedMilliseconds: max(0, elapsedMilliseconds))
  }

  public var isControlled: Bool { elapsedMilliseconds != nil }

  /// Moves a controlled driver to an exact instant.
  ///
  /// Negative time is clamped rather than accepted: the resolver throws on an
  /// untrusted clock, and a driver that could hand it one would turn a caller's
  /// arithmetic slip into a trap inside a host application.
  public func advance(to milliseconds: Int) {
    guard isControlled else { return }
    elapsedMilliseconds = max(0, milliseconds)
    tickCount += 1
  }

  public func advance(by milliseconds: Int) {
    advance(to: (elapsedMilliseconds ?? 0) + milliseconds)
  }

  /// Republishes without moving time. The Countdown's cadence, and how a
  /// controlled driver can force a redraw.
  public func tick() { tickCount += 1 }

  // MARK: - Screen entry

  /// The driver time at which the screen now on show was entered.
  ///
  /// `appear` and `loop` both measure from node entry, and for a node authored
  /// on a screen that is the moment the screen was entered. A platform-driven
  /// renderer gets this from the view lifecycle for free — a screen the user
  /// leaves discards its nodes, and returning builds them again with fresh state
  /// — but a controlled driver has no lifecycle to read, so the origin has to be
  /// recorded.
  @Published public private(set) var screenEntryElapsedMilliseconds = 0

  /// How many genuine screen entries have happened, starting at zero before the
  /// first.
  @Published public private(set) var screenEntryCount = 0

  private var enteredScreenID: String?

  /// Records entry into `screenID`, if that is a genuine entry.
  ///
  /// A genuine entry is a *change* of screen. Returning to a screen you left is
  /// one, so its entrances and its bounded pulse run again. Re-evaluating the
  /// body of the screen you are already on is not, and neither is presenting a
  /// sheet over it: the screen underneath keeps its nodes, so replaying its
  /// entrances when the sheet closed would animate content that never left.
  ///
  /// The renderer passes the base screen for exactly that reason.
  public func enterScreen(_ screenID: String?) {
    guard screenEntryCount == 0 || screenID != enteredScreenID else { return }
    enteredScreenID = screenID
    screenEntryElapsedMilliseconds = elapsedMilliseconds ?? 0
    screenEntryCount += 1
  }

  /// `elapsed` re-expressed against the current screen entry, which is the
  /// origin the contract measures `appear` and `loop` from.
  public func nodeElapsedMilliseconds(at elapsed: Int) -> Int {
    max(0, elapsed - screenEntryElapsedMilliseconds)
  }

  /// The one-second cadence a Countdown redraws on.
  ///
  /// It runs only for a platform-driven driver: a controlled driver's caller
  /// decides when time passes, and a background loop that ticked anyway would
  /// make a test's rendering depend on how long the test took.
  func runCadence(intervalNanoseconds: UInt64 = 1_000_000_000) async {
    guard isEnabled, !isControlled else { return }
    while !Task.isCancelled {
      try? await Task.sleep(nanoseconds: intervalNanoseconds)
      guard !Task.isCancelled else { return }
      tick()
    }
  }
}

/// The accessibility signals motion is allowed to read.
///
/// Injected at the renderer boundary rather than sampled deep in the view tree,
/// so a test states the user's preference instead of the simulator's.
public struct MosaicMotionAccessibility: Sendable, Equatable {
  /// `UIAccessibility.isReduceMotionEnabled`. Under it, `appear` drops its
  /// transform and keeps its opacity, `selection` applies instantly, and `loop`
  /// never leaves rest.
  public let prefersReducedMotion: Bool

  /// `UIAccessibility.isVideoAutoplayEnabled`.
  ///
  /// `0.3` specifies a video background as always autoplaying and control-free,
  /// which can invalidate a customer's App Store Reduced Motion declaration.
  /// `0.4` rules that a video background does not play under reduced motion, and
  /// Apple gives users a second, narrower switch for exactly this; both are
  /// honoured, because a user who turned off autoplaying video meant it.
  public let allowsVideoAutoplay: Bool

  public init(prefersReducedMotion: Bool, allowsVideoAutoplay: Bool = true) {
    self.prefersReducedMotion = prefersReducedMotion
    self.allowsVideoAutoplay = allowsVideoAutoplay
  }

  /// Whether a declared video background may play.
  public var permitsVideoPlayback: Bool { !prefersReducedMotion && allowsVideoAutoplay }

  public static let unrestricted = MosaicMotionAccessibility(
    prefersReducedMotion: false, allowsVideoAutoplay: true)

  public static let reduced = MosaicMotionAccessibility(
    prefersReducedMotion: true, allowsVideoAutoplay: false)

  /// The platform's current answer for the signal SwiftUI does not surface.
  /// Reduce Motion itself arrives through `\.accessibilityReduceMotion`.
  public static var systemAllowsVideoAutoplay: Bool {
    #if os(iOS)
      return UIAccessibility.isVideoAutoplayEnabled
    #else
      return true
    #endif
  }
}

struct MosaicMotionAccessibilityEnvironmentKey: EnvironmentKey {
  static let defaultValue = MosaicMotionAccessibility.unrestricted
}

extension EnvironmentValues {
  /// The resolved accessibility signal, decided once at the renderer boundary.
  var mosaicMotionAccessibility: MosaicMotionAccessibility {
    get { self[MosaicMotionAccessibilityEnvironmentKey.self] }
    set { self[MosaicMotionAccessibilityEnvironmentKey.self] = newValue }
  }
}

extension MosaicResolvedMotionCurve {
  /// The SwiftUI animation for this curve.
  ///
  /// The four presets map directly onto `timingCurve(_:_:_:_:duration:)`, which
  /// is the whole reason the contract chose cubic beziers: it is the one curve
  /// family that is faithfully portable across SwiftUI, Compose, and Flutter.
  var animation: Animation {
    let points = easing.controlPoints
    return .timingCurve(
      points.x1, points.y1, points.x2, points.y2, duration: durationSeconds)
  }
}
