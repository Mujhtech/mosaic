import Foundation

// Protocol 0.4 adds authored motion: a fourth design-token catalog, a `motion`
// block on a node, and three primitives constrained by trigger. Nothing here
// names a SwiftUI type: the renderer maps these values onto SwiftUI, and the
// conformance vectors in `protocol/fixtures/v0.4/motion-frames.json` are the
// contract every value below is bound to.

// MARK: - Easing

/// The cubic-bezier control points of one easing preset.
///
/// Cubic beziers are the one curve family that is faithfully portable across
/// SwiftUI `timingCurve(_:_:_:_:)`, Compose `CubicBezierEasing`, and Flutter
/// `Cubic`, which is why `0.4` chose them. Springs and authored control points
/// are excluded by the contract, so this carries no way to express either.
public struct MosaicCubicBezierControlPoints: Sendable, Equatable {
  public let x1: Double
  public let y1: Double
  public let x2: Double
  public let y2: Double

  public init(x1: Double, y1: Double, x2: Double, y2: Double) {
    self.x1 = x1
    self.y1 = y1
    self.x2 = x2
    self.y2 = y2
  }

  /// The curve's `y` at a fraction of its duration.
  ///
  /// Newton-Raphson with a bisection fallback, mirroring the reference resolver
  /// in `protocol/tools/validation-v0.4.mjs` step for step. The two must agree
  /// to the contract's `1e-3` tolerance, and the cheapest way to guarantee that
  /// is to solve the curve the same way rather than a different way that
  /// happens to be close.
  public func y(at x: Double) -> Double {
    if x <= 0 { return 0 }
    if x >= 1 { return 1 }
    func axis(_ a: Double, _ b: Double) -> (Double) -> Double {
      { t in 3 * pow(1 - t, 2) * t * a + 3 * (1 - t) * pow(t, 2) * b + pow(t, 3) }
    }
    let curveX = axis(x1, x2)
    let curveY = axis(y1, y2)
    func slopeX(_ t: Double) -> Double {
      3 * pow(1 - t, 2) * x1 + 6 * (1 - t) * t * (x2 - x1) + 3 * pow(t, 2) * (1 - x2)
    }

    var parameter = x
    for _ in 0..<8 {
      let error = curveX(parameter) - x
      if abs(error) < 1e-12 { return curveY(parameter) }
      let derivative = slopeX(parameter)
      if abs(derivative) < 1e-9 { break }
      parameter -= error / derivative
    }
    var low = 0.0
    var high = 1.0
    parameter = x
    for _ in 0..<64 {
      let value = curveX(parameter)
      if abs(value - x) < 1e-12 { break }
      if value > x { high = parameter } else { low = parameter }
      parameter = (low + high) / 2
    }
    return curveY(parameter)
  }
}

/// One of exactly four presets. The contract excludes authored control points,
/// so an unrecognised value rejects the document rather than degrading.
public enum MosaicMotionEasing: String, Decodable, Sendable, CaseIterable, Equatable {
  case linear, standard, decelerate, accelerate

  public var controlPoints: MosaicCubicBezierControlPoints {
    switch self {
    case .linear: MosaicCubicBezierControlPoints(x1: 0, y1: 0, x2: 1, y2: 1)
    case .standard: MosaicCubicBezierControlPoints(x1: 0.4, y1: 0, x2: 0.2, y2: 1)
    case .decelerate: MosaicCubicBezierControlPoints(x1: 0, y1: 0, x2: 0.2, y2: 1)
    case .accelerate: MosaicCubicBezierControlPoints(x1: 0.4, y1: 0, x2: 1, y2: 1)
    }
  }

  /// Eased progress in `0...1` for a fraction of a curve's duration.
  public func progress(atFraction fraction: Double) -> Double {
    controlPoints.y(at: fraction)
  }
}

// MARK: - Curves and the motion catalog

/// A duration and an easing as one composite, resolved to an inline value.
public struct MosaicResolvedMotionCurve: Sendable, Equatable {
  public let durationMilliseconds: Int
  public let easing: MosaicMotionEasing

  public init(durationMilliseconds: Int, easing: MosaicMotionEasing) {
    self.durationMilliseconds = durationMilliseconds
    self.easing = easing
  }

  public var durationSeconds: Double { Double(durationMilliseconds) / 1000 }
}

/// An inline curve or a reference into `designSystem.motions`, mirroring the
/// `inlineShadow` / `shadowTokenReference` pair exactly.
public enum MosaicMotionCurve: Decodable, Sendable, Equatable {
  case inline(MosaicResolvedMotionCurve)
  case token(String)

  private enum CodingKeys: String, CodingKey { case type, durationMilliseconds, easing, id }
  private enum Kind: String, Decodable { case motion, motionToken }

  public init(from decoder: any Decoder) throws {
    let container = try decoder.container(keyedBy: CodingKeys.self)
    switch try container.decode(Kind.self, forKey: .type) {
    case .motion:
      self = .inline(
        MosaicResolvedMotionCurve(
          durationMilliseconds: try container.decode(Int.self, forKey: .durationMilliseconds),
          easing: try container.decode(MosaicMotionEasing.self, forKey: .easing)
        )
      )
    case .motionToken:
      self = .token(try container.decode(String.self, forKey: .id))
    }
  }

  public var tokenID: String? {
    guard case .token(let id) = self else { return nil }
    return id
  }
}

public struct MosaicMotionToken: Decodable, Sendable, Equatable, Identifiable {
  public let id: String
  public let name: String
  public let value: MosaicMotionCurve
}

// MARK: - The three primitives

public enum MosaicAppearEffect: String, Decodable, Sendable, Equatable { case fade, fadeRise }

/// Plays once when the node first enters a screen.
///
/// `riseLogicalSize` is required with `fadeRise` and forbidden with `fade`; the
/// shape validator enforces both directions, so an absent value here means the
/// effect is `fade` and the node does not travel.
public struct MosaicAppearMotion: Decodable, Sendable, Equatable {
  public let effect: MosaicAppearEffect
  public let riseLogicalSize: Double?
  public let curve: MosaicMotionCurve
  public let delayMilliseconds: Int

  /// How far the node travels. `fade` never travels, so this is `0` for it
  /// rather than an absent value the renderer would have to interpret.
  public var resolvedRiseLogicalSize: Double {
    effect == .fadeRise ? (riseLogicalSize ?? 0) : 0
  }
}

/// Interpolates the authored Default and Selected box styles when the runtime
/// selection changes. Allowed only on the two components that own selection
/// state.
public struct MosaicSelectionMotion: Decodable, Sendable, Equatable {
  public let curve: MosaicMotionCurve
}

public enum MosaicLoopEffect: String, Decodable, Sendable, Equatable { case pulse }

/// A bounded call-to-action pulse. There is no `forever` mode in the contract:
/// a bounded count needs no stop control because it stops.
public struct MosaicLoopMotion: Decodable, Sendable, Equatable {
  public let effect: MosaicLoopEffect
  public let scaleAmplitude: Double
  public let opacityAmplitude: Double
  public let curve: MosaicMotionCurve
  public let repeatCount: Int

  private enum CodingKeys: String, CodingKey {
    case effect, scaleAmplitude, opacityAmplitude, curve, `repeat`
  }
  private enum RepeatKeys: String, CodingKey { case count }

  public init(from decoder: any Decoder) throws {
    let container = try decoder.container(keyedBy: CodingKeys.self)
    effect = try container.decode(MosaicLoopEffect.self, forKey: .effect)
    scaleAmplitude = try container.decode(Double.self, forKey: .scaleAmplitude)
    opacityAmplitude = try container.decode(Double.self, forKey: .opacityAmplitude)
    curve = try container.decode(MosaicMotionCurve.self, forKey: .curve)
    let repeats = try container.nestedContainer(keyedBy: RepeatKeys.self, forKey: .repeat)
    repeatCount = try repeats.decode(Int.self, forKey: .count)
  }
}

/// The `motion` block a node may carry.
///
/// One type covers all three attachment shapes the schema declares. Which
/// members are legal on which node is a document rule rather than a decoding
/// one, so it is enforced where every other document rule is: in the shape and
/// semantic validators.
public struct MosaicMotion: Decodable, Sendable, Equatable {
  public let appear: MosaicAppearMotion?
  public let selection: MosaicSelectionMotion?
  public let loop: MosaicLoopMotion?

  public init(
    appear: MosaicAppearMotion? = nil,
    selection: MosaicSelectionMotion? = nil,
    loop: MosaicLoopMotion? = nil
  ) {
    self.appear = appear
    self.selection = selection
    self.loop = loop
  }
}

// MARK: - Token resolution

extension MosaicPaywallDocument {
  /// Resolves a curve reference to its inline value, or `nil` when the token is
  /// unknown or the reference graph cycles. Mirrors `resolvedShadow(_:)`.
  public func resolvedMotionCurve(_ curve: MosaicMotionCurve) -> MosaicResolvedMotionCurve? {
    resolveMotionCurve(curve, visiting: [])
  }

  private func resolveMotionCurve(
    _ curve: MosaicMotionCurve,
    visiting: Set<String>
  ) -> MosaicResolvedMotionCurve? {
    switch curve {
    case .inline(let value):
      return value
    case .token(let id):
      guard !visiting.contains(id),
        let token = designSystem?.motions.first(where: { $0.id == id })
      else { return nil }
      return resolveMotionCurve(token.value, visiting: visiting.union([id]))
    }
  }
}

// MARK: - Frames

/// Why a frame could not be resolved.
///
/// The resolver throws rather than answering, following the
/// `resolveV03CountdownState` precedent: arithmetic on an untrusted clock or an
/// unresolved curve yields a frame that reads back as plausible.
public enum MosaicMotionResolutionError: Error, Sendable, Equatable {
  case invalidElapsedTime
  case unresolvedCurve
  case invalidRepeatCount
}

/// The `appear` frame at an instant.
///
/// `translateLogicalSize` is the remaining distance to the node's laid-out
/// position, so the terminal frame is `0` and the node ends exactly where the
/// static rendering puts it.
public struct MosaicAppearFrame: Sendable, Equatable {
  public let complete: Bool
  public let progress: Double
  public let opacity: Double
  public let translateLogicalSize: Double

  /// Whether this frame draws the static rendering. The renderer applies no
  /// modifier at all when it does, which is what makes the terminal-state rule
  /// true by construction rather than by arithmetic.
  public var isStatic: Bool { complete }
}

public struct MosaicSelectionFrame: Sendable, Equatable {
  public let complete: Bool
  public let progress: Double
  public let style: MosaicSelectionStateStyle
}

public struct MosaicLoopFrame: Sendable, Equatable {
  public let complete: Bool
  public let cycle: Int
  public let cyclePhase: Double
  public let excursion: Double
  public let scale: Double
  public let opacityMultiplier: Double

  public var isStatic: Bool { scale == 1 && opacityMultiplier == 1 }
}

/// Emitted numbers carry four decimal places.
///
/// `Math.round` in the reference resolver is a half-up round, not Swift's
/// half-away-from-zero, so this is written as `floor(x + 0.5)` rather than
/// `rounded()`: for a negative shadow offset landing exactly on a half the two
/// disagree, and the conformance vectors are generated by the former.
func mosaicMotionRound4(_ value: Double) -> Double {
  let rounded = (value * 10_000 + 0.5).rounded(.down) / 10_000
  return rounded == 0 ? 0 : rounded
}

/// The frame a renderer must be showing at an exact elapsed time.
///
/// Two rules hold in every branch, and they are what make the contract's
/// `renderWithoutMotion` tier lossless:
///
/// - **Terminal state.** Once the motion has run its authored course the output
///   is the static rendering exactly. It is short-circuited rather than
///   approached, so no accumulation of rounding can leave a price at `0.9999`
///   opacity.
/// - **Reduced motion.** `appear` keeps its opacity change and drops the
///   transform, `selection` applies instantly, and `loop` never leaves rest.
public enum MosaicMotionResolver {

  // MARK: appear

  public static func appearFrame(
    _ motion: MosaicAppearMotion,
    curve: MosaicResolvedMotionCurve,
    elapsedMilliseconds: Int,
    reducedMotion: Bool
  ) throws -> MosaicAppearFrame {
    guard elapsedMilliseconds >= 0 else { throw MosaicMotionResolutionError.invalidElapsedTime }
    let start = motion.delayMilliseconds
    let end = start + curve.durationMilliseconds
    if elapsedMilliseconds >= end { return terminalAppearFrame }
    if elapsedMilliseconds <= start {
      return MosaicAppearFrame(
        complete: false,
        progress: 0,
        opacity: 0,
        translateLogicalSize: reducedMotion
          ? 0 : mosaicMotionRound4(motion.resolvedRiseLogicalSize)
      )
    }
    let fraction = Double(elapsedMilliseconds - start) / Double(curve.durationMilliseconds)
    return appearFrame(
      motion,
      easedProgress: curve.easing.progress(atFraction: fraction),
      reducedMotion: reducedMotion
    )
  }

  /// The same value mapping, from an eased progress the platform supplied.
  ///
  /// SwiftUI solves the identical cubic bezier for the two one-shot primitives,
  /// so the renderer hands the eased progress here rather than re-deriving it
  /// from a second clock. One mapping, two sources of progress, no way for the
  /// animated path and the conformance path to disagree about a value.
  public static func appearFrame(
    _ motion: MosaicAppearMotion,
    easedProgress: Double,
    reducedMotion: Bool
  ) -> MosaicAppearFrame {
    guard easedProgress < 1 else { return terminalAppearFrame }
    let progress = max(0, easedProgress)
    return MosaicAppearFrame(
      complete: false,
      progress: mosaicMotionRound4(progress),
      opacity: mosaicMotionRound4(progress),
      translateLogicalSize: reducedMotion
        ? 0 : mosaicMotionRound4(motion.resolvedRiseLogicalSize * (1 - progress))
    )
  }

  public static let terminalAppearFrame = MosaicAppearFrame(
    complete: true, progress: 1, opacity: 1, translateLogicalSize: 0)

  // MARK: selection

  public static func selectionFrame(
    curve: MosaicResolvedMotionCurve,
    elapsedMilliseconds: Int,
    reducedMotion: Bool,
    from: MosaicSelectionStateStyle,
    to: MosaicSelectionStateStyle
  ) throws -> MosaicSelectionFrame {
    guard elapsedMilliseconds >= 0 else { throw MosaicMotionResolutionError.invalidElapsedTime }
    if reducedMotion || elapsedMilliseconds >= curve.durationMilliseconds {
      return MosaicSelectionFrame(complete: true, progress: 1, style: to)
    }
    let fraction = Double(elapsedMilliseconds) / Double(curve.durationMilliseconds)
    return selectionFrame(
      easedProgress: curve.easing.progress(atFraction: fraction),
      reducedMotion: reducedMotion,
      from: from,
      to: to
    )
  }

  public static func selectionFrame(
    easedProgress: Double,
    reducedMotion: Bool,
    from: MosaicSelectionStateStyle,
    to: MosaicSelectionStateStyle
  ) -> MosaicSelectionFrame {
    guard !reducedMotion, easedProgress < 1 else {
      return MosaicSelectionFrame(complete: true, progress: 1, style: to)
    }
    let progress = max(0, easedProgress)
    return MosaicSelectionFrame(
      complete: false,
      progress: mosaicMotionRound4(progress),
      style: interpolate(from: from, to: to, progress: progress)
    )
  }

  // MARK: loop

  public static func loopFrame(
    _ motion: MosaicLoopMotion,
    curve: MosaicResolvedMotionCurve,
    elapsedMilliseconds: Int,
    reducedMotion: Bool
  ) throws -> MosaicLoopFrame {
    guard elapsedMilliseconds >= 0 else { throw MosaicMotionResolutionError.invalidElapsedTime }
    guard motion.repeatCount >= 1 else { throw MosaicMotionResolutionError.invalidRepeatCount }
    guard curve.durationMilliseconds > 0 else { throw MosaicMotionResolutionError.unresolvedCurve }
    let cycleMilliseconds = curve.durationMilliseconds
    let totalMilliseconds = cycleMilliseconds * motion.repeatCount
    if reducedMotion { return restingLoopFrame(cycle: 0) }
    if elapsedMilliseconds >= totalMilliseconds {
      return restingLoopFrame(cycle: motion.repeatCount)
    }
    let cycle = elapsedMilliseconds / cycleMilliseconds
    let cyclePhase =
      Double(elapsedMilliseconds - cycle * cycleMilliseconds) / Double(cycleMilliseconds)
    // One pulse is out and back. The easing shapes each half, so the excursion
    // is 0 at both ends of every cycle, which makes a cycle boundary and the
    // terminal frame the same static rendering rather than two near misses.
    let halfPhase = cyclePhase < 0.5 ? cyclePhase * 2 : (1 - cyclePhase) * 2
    let excursion = curve.easing.progress(atFraction: halfPhase)
    return MosaicLoopFrame(
      complete: false,
      cycle: cycle,
      cyclePhase: mosaicMotionRound4(cyclePhase),
      excursion: mosaicMotionRound4(excursion),
      scale: mosaicMotionRound4(1 + motion.scaleAmplitude * excursion),
      opacityMultiplier: mosaicMotionRound4(1 - motion.opacityAmplitude * excursion)
    )
  }

  public static func restingLoopFrame(cycle: Int) -> MosaicLoopFrame {
    MosaicLoopFrame(
      complete: true, cycle: cycle, cyclePhase: 0, excursion: 0, scale: 1, opacityMultiplier: 1)
  }

  // MARK: selection-style interpolation

  /// The closed interpolable field list.
  ///
  /// A semantic colour resolves against the renderer's theme and a `colorToken`
  /// against the document, and neither has a numeric value the protocol can
  /// average, so rather than invent one the change applies at the half-way
  /// point. Padding is structural: interpolating it relayouts the subtree every
  /// frame on three layout engines that disagree about when that is legal.
  static func interpolate(
    from: MosaicSelectionStateStyle,
    to: MosaicSelectionStateStyle,
    progress: Double
  ) -> MosaicSelectionStateStyle {
    MosaicSelectionStateStyle(
      background: interpolate(
        background: from.background, to: to.background, progress: progress),
      border: MosaicBorder(
        color: interpolate(color: from.border.color, to: to.border.color, progress: progress),
        width: interpolate(from.border.width, to.border.width, progress)
      ),
      cornerRadius: interpolate(from.cornerRadius, to.cornerRadius, progress),
      padding: progress < 0.5 ? from.padding : to.padding,
      opacity: interpolate(from.opacity, to.opacity, progress),
      shadow: from.shadow == nil && to.shadow == nil
        ? nil
        : interpolate(shadow: from.shadow, to: to.shadow, progress: progress)
    )
  }

  private static func interpolate(_ from: Double, _ to: Double, _ progress: Double) -> Double {
    mosaicMotionRound4(from + (to - from) * progress)
  }

  private static func interpolate(
    color from: MosaicColor,
    to: MosaicColor,
    progress: Double
  ) -> MosaicColor {
    if from == to { return to }
    guard case .literal(let start) = from, case .literal(let end) = to,
      isCanonicalLiteral(start), isCanonicalLiteral(end)
    else { return progress < 0.5 ? from : to }
    var mixed = "#"
    for offset in stride(from: 1, to: 9, by: 2) {
      let startIndex = start.index(start.startIndex, offsetBy: offset)
      let endIndex = end.index(end.startIndex, offsetBy: offset)
      guard
        let low = UInt16(
          start[startIndex..<start.index(startIndex, offsetBy: 2)], radix: 16),
        let high = UInt16(end[endIndex..<end.index(endIndex, offsetBy: 2)], radix: 16)
      else { return progress < 0.5 ? from : to }
      let channel = Int(
        (Double(low) + (Double(high) - Double(low)) * progress + 0.5).rounded(.down))
      mixed += String(format: "%02X", max(0, min(255, channel)))
    }
    return .literal(mixed)
  }

  private static func isCanonicalLiteral(_ raw: String) -> Bool {
    raw.range(of: "^#[0-9A-F]{8}$", options: .regularExpression) != nil
  }

  private static func interpolate(
    background from: MosaicBackground,
    to: MosaicBackground,
    progress: Double
  ) -> MosaicBackground {
    guard case .color(let start) = from, case .color(let end) = to else {
      // A background *kind* change is not a value change, so it switches
      // discretely rather than being averaged into something nobody authored.
      return progress < 0.5 ? from : to
    }
    return .color(interpolate(color: start, to: end, progress: progress))
  }

  private static func interpolate(
    shadow from: MosaicShadow?,
    to: MosaicShadow?,
    progress: Double
  ) -> MosaicShadow? {
    guard case .value(let fromColor, let fromX, let fromY, let fromBlur)? = from,
      case .value(let toColor, let toX, let toY, let toBlur)? = to
    else { return progress < 0.5 ? from : to }
    return .value(
      color: interpolate(color: fromColor, to: toColor, progress: progress),
      offsetX: interpolate(fromX, toX, progress),
      offsetY: interpolate(fromY, toY, progress),
      blurRadius: interpolate(fromBlur, toBlur, progress)
    )
  }
}
