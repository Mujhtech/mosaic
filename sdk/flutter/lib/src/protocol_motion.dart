part of 'protocol.dart';

/// One of the four Protocol 0.4 easing presets.
///
/// Authored control points and springs are excluded from the contract: an
/// out-of-range `y` fakes a spring, and overshoot is exactly where the three
/// platforms clamp opacity and scale differently. Every preset here is
/// monotonic and stays inside `0…1`.
enum MosaicMotionEasing { linear, standard, decelerate, accelerate }

/// The normative cubic-bezier control points for each preset.
///
/// Published as data rather than described in prose because three renderers
/// have to draw the same curve. They map exactly onto Flutter's `Cubic`,
/// SwiftUI's `timingCurve`, and Compose's `CubicBezierEasing`.
const Map<MosaicMotionEasing, (double, double, double, double)>
    mosaicMotionEasingControlPoints =
    <MosaicMotionEasing, (double, double, double, double)>{
  MosaicMotionEasing.linear: (0, 0, 1, 1),
  MosaicMotionEasing.standard: (0.4, 0, 0.2, 1),
  MosaicMotionEasing.decelerate: (0, 0, 0.2, 1),
  MosaicMotionEasing.accelerate: (0.4, 0, 1, 1),
};

/// The flash-safety floor a looping motion's curve must clear, in milliseconds.
///
/// A 500 ms cycle caps the pulse's fundamental at 2 Hz and its perceived rate
/// at 1 Hz, an order of magnitude below the three-per-second threshold WCAG
/// 2.3.1 draws. It is checked at the reference site rather than on the token,
/// because the same 240 ms token is legitimate for an entrance and
/// illegitimate for a pulse.
const int mosaicLoopMinimumDurationMilliseconds = 500;

/// A duration and an easing as one composite.
///
/// Neither is meaningful without the other: a duration with no curve and a
/// curve with no duration are both half a decision.
sealed class MosaicMotion {
  const MosaicMotion();
}

final class MosaicInlineMotion extends MosaicMotion {
  const MosaicInlineMotion({
    required this.durationMilliseconds,
    required this.easing,
  });

  /// Whole milliseconds, `0…2000`. `0` means the change applies instantly.
  final int durationMilliseconds;
  final MosaicMotionEasing easing;
}

final class MosaicMotionTokenReference extends MosaicMotion {
  const MosaicMotionTokenReference(this.id);

  final String id;
}

enum MosaicAppearEffect { fade, fadeRise }

/// Plays once when the node first enters a screen.
final class MosaicAppearMotion {
  const MosaicAppearMotion({
    required this.effect,
    required this.curve,
    required this.delayMilliseconds,
    this.riseLogicalSize,
  });

  final MosaicAppearEffect effect;

  /// Required with [MosaicAppearEffect.fadeRise] and absent with `fade`. The
  /// node travels *to* its laid-out position, so its final geometry is its
  /// static geometry.
  final double? riseLogicalSize;
  final MosaicMotion curve;

  /// Held before the effect starts. Authored stagger is expressed by giving
  /// siblings different delays; `0.4` has no stagger sugar.
  final int delayMilliseconds;

  MosaicAppearMotion _withCurve(MosaicInlineMotion resolved) =>
      MosaicAppearMotion(
        effect: effect,
        curve: resolved,
        delayMilliseconds: delayMilliseconds,
        riseLogicalSize: riseLogicalSize,
      );
}

/// Interpolates the authored Default and Selected box styles when the runtime
/// selection changes.
final class MosaicSelectionMotion {
  const MosaicSelectionMotion({required this.curve});

  final MosaicMotion curve;

  MosaicSelectionMotion _withCurve(MosaicInlineMotion resolved) =>
      MosaicSelectionMotion(curve: resolved);
}

enum MosaicLoopEffect { pulse }

/// A bounded call-to-action pulse: an authored number of cycles, then
/// permanent rest. There is no unbounded mode in the contract.
final class MosaicLoopMotion {
  const MosaicLoopMotion({
    required this.effect,
    required this.scaleAmplitude,
    required this.opacityAmplitude,
    required this.curve,
    required this.repeatCount,
  });

  final MosaicLoopEffect effect;

  /// Peak outward scale excursion, `0 < value <= 0.06`.
  final double scaleAmplitude;

  /// Peak inward opacity excursion as a fraction of the node's resolved static
  /// opacity, `0 <= value <= 0.2`. The floor is `resolvedOpacity × (1 − value)`
  /// and the rest value is `resolvedOpacity` exactly.
  final double opacityAmplitude;
  final MosaicMotion curve;

  /// Cycles played before the node rests permanently, `1…5`.
  final int repeatCount;

  MosaicLoopMotion _withCurve(MosaicInlineMotion resolved) => MosaicLoopMotion(
        effect: effect,
        scaleAmplitude: scaleAmplitude,
        opacityAmplitude: opacityAmplitude,
        curve: resolved,
        repeatCount: repeatCount,
      );
}

/// The authored motion block on one node.
///
/// Which members a node may carry depends on what the node is: `appear` on any
/// node except the screen Scroll Container, `selection` on Product Selector and
/// Tabs, `loop` on Button. The decoder enforces that partition.
final class MosaicNodeMotion {
  const MosaicNodeMotion({this.appear, this.selection, this.loop});

  final MosaicAppearMotion? appear;
  final MosaicSelectionMotion? selection;
  final MosaicLoopMotion? loop;
}

/// The glyph beside a Feature List item or at a Timeline entry's position.
///
/// One closed union shared by both components. An earlier contract carried
/// Feature List's
/// single `"checkmark"` constant beside Timeline's three-arm union, which meant
/// a list could not express a negated item; `0.4` consolidates on this shape.
sealed class MosaicMarker {
  const MosaicMarker();
}

final class MosaicDotMarker extends MosaicMarker {
  const MosaicDotMarker();
}

/// The item's or entry's 1-based position in its array.
final class MosaicOrdinalMarker extends MosaicMarker {
  const MosaicOrdinalMarker();
}

final class MosaicIconMarker extends MosaicMarker {
  const MosaicIconMarker(this.name);

  final MosaicIconName name;
}

/// Retained spelling of the shared marker union.
typedef MosaicTimelineMarker = MosaicMarker;
typedef MosaicTimelineDotMarker = MosaicDotMarker;
typedef MosaicTimelineOrdinalMarker = MosaicOrdinalMarker;
typedef MosaicTimelineIconMarker = MosaicIconMarker;

/// Eased progress in `0…1` for a fraction of a curve's duration.
///
/// The solver is Newton–Raphson with a bisection fallback, matching the
/// reference resolver in `protocol/tools/validation-v0.4.mjs` step for step.
/// Flutter's own `Cubic` bisects to a 1e-3 error bound in `x`, which is the
/// stated conformance tolerance in `y` — too coarse to assert against.
double mosaicEasedProgress(MosaicMotionEasing easing, double fraction) {
  final (x1, y1, x2, y2) = mosaicMotionEasingControlPoints[easing]!;
  if (fraction <= 0) return 0;
  if (fraction >= 1) return 1;

  double axis(double a, double b, double t) =>
      3 * (1 - t) * (1 - t) * t * a + 3 * (1 - t) * t * t * b + t * t * t;
  double curveX(double t) => axis(x1, x2, t);
  double curveY(double t) => axis(y1, y2, t);
  double slopeX(double t) =>
      3 * (1 - t) * (1 - t) * x1 +
      6 * (1 - t) * t * (x2 - x1) +
      3 * t * t * (1 - x2);

  var parameter = fraction;
  for (var step = 0; step < 8; step += 1) {
    final error = curveX(parameter) - fraction;
    if (error.abs() < 1e-12) return curveY(parameter);
    final derivative = slopeX(parameter);
    if (derivative.abs() < 1e-9) break;
    parameter -= error / derivative;
  }
  var low = 0.0;
  var high = 1.0;
  parameter = fraction;
  for (var step = 0; step < 64; step += 1) {
    final value = curveX(parameter);
    if ((value - fraction).abs() < 1e-12) break;
    if (value > fraction) {
      high = parameter;
    } else {
      low = parameter;
    }
    parameter = (low + high) / 2;
  }
  return curveY(parameter);
}

/// The frame an entrance must be showing at an exact elapsed time.
final class MosaicAppearFrame {
  const MosaicAppearFrame({
    required this.complete,
    required this.progress,
    required this.opacity,
    required this.translateLogicalSize,
  });

  /// Whether the motion has run its authored course. A complete frame is the
  /// static rendering exactly.
  final bool complete;
  final double progress;
  final double opacity;

  /// How far the node still has to travel, in logical units. Always `0` under
  /// reduced motion, including at the start frame.
  final double translateLogicalSize;
}

/// The interpolated box style a selection change must be showing.
final class MosaicSelectionFrame {
  const MosaicSelectionFrame({
    required this.complete,
    required this.progress,
    required this.style,
  });

  final bool complete;
  final double progress;
  final MosaicSelectionStateStyle style;
}

/// The scale and opacity multiplier a pulse must be showing.
final class MosaicLoopFrame {
  const MosaicLoopFrame({
    required this.complete,
    required this.cycle,
    required this.cyclePhase,
    required this.excursion,
    required this.scale,
    required this.opacityMultiplier,
  });

  final bool complete;
  final int cycle;
  final double cyclePhase;
  final double excursion;
  final double scale;

  /// Multiplies the node's resolved static opacity. `1` is the rest value, so
  /// a node that authored `appearance.opacity: 0.8` rests at `0.8`.
  final double opacityMultiplier;
}

/// A frame was requested from an elapsed time or a curve that cannot produce
/// one.
///
/// The resolvers throw rather than resolve, following the countdown precedent:
/// arithmetic on a clock that cannot be trusted yields a frame that reads back
/// as plausible.
final class MosaicMotionFrameException implements Exception {
  const MosaicMotionFrameException(this.message);

  final String message;

  @override
  String toString() => 'MosaicMotionFrameException: $message';
}

MosaicInlineMotion _requireResolvedCurve(MosaicMotion curve) {
  if (curve is MosaicInlineMotion) return curve;
  throw const MosaicMotionFrameException(
    'Motion frame resolution requires an inline curve; resolve motionToken '
    'references against the document first.',
  );
}

void _requireWholeElapsed(int elapsedMilliseconds) {
  if (elapsedMilliseconds < 0) {
    throw const MosaicMotionFrameException(
      'Motion frame resolution requires a whole, non-negative elapsed time in '
      'milliseconds.',
    );
  }
}

/// The entrance frame at [elapsedMilliseconds] since the node entered.
///
/// Terminal state is short-circuited rather than approached, so no accumulation
/// of rounding can leave a price at `0.9999` opacity or a node one logical unit
/// short of its laid-out position.
MosaicAppearFrame resolveMosaicAppearFrame(
  MosaicAppearMotion motion, {
  required int elapsedMilliseconds,
  required bool reducedMotion,
}) {
  _requireWholeElapsed(elapsedMilliseconds);
  final curve = _requireResolvedCurve(motion.curve);
  // Reduced motion is opacity only: the transform is dropped at every instant,
  // including the start frame. The contract owns *what* changes; the platform
  // owns how long the remaining opacity change takes.
  final rise = motion.effect == MosaicAppearEffect.fadeRise
      ? (motion.riseLogicalSize ?? 0)
      : 0.0;
  final start = motion.delayMilliseconds;
  final end = start + curve.durationMilliseconds;
  if (elapsedMilliseconds >= end) {
    return const MosaicAppearFrame(
      complete: true,
      progress: 1,
      opacity: 1,
      translateLogicalSize: 0,
    );
  }
  if (elapsedMilliseconds <= start) {
    return MosaicAppearFrame(
      complete: false,
      progress: 0,
      opacity: 0,
      translateLogicalSize: reducedMotion ? 0 : rise,
    );
  }
  final fraction = (elapsedMilliseconds - start) / curve.durationMilliseconds;
  final progress = mosaicEasedProgress(curve.easing, fraction);
  return MosaicAppearFrame(
    complete: false,
    progress: progress,
    opacity: progress,
    translateLogicalSize: reducedMotion ? 0 : rise * (1 - progress),
  );
}

/// The selection frame at [elapsedMilliseconds] since the selection changed.
MosaicSelectionFrame resolveMosaicSelectionFrame(
  MosaicSelectionMotion motion, {
  required int elapsedMilliseconds,
  required bool reducedMotion,
  required MosaicSelectionStateStyle resolvedFrom,
  required MosaicSelectionStateStyle resolvedTo,
}) {
  _requireWholeElapsed(elapsedMilliseconds);
  final curve = _requireResolvedCurve(motion.curve);
  if (reducedMotion || elapsedMilliseconds >= curve.durationMilliseconds) {
    return MosaicSelectionFrame(
      complete: true,
      progress: 1,
      style: resolvedTo,
    );
  }
  final progress = mosaicEasedProgress(
    curve.easing,
    elapsedMilliseconds / curve.durationMilliseconds,
  );
  return MosaicSelectionFrame(
    complete: false,
    progress: progress,
    style: _interpolateSelectionStyle(resolvedFrom, resolvedTo, progress),
  );
}

/// The pulse frame at [elapsedMilliseconds] since the loop started.
MosaicLoopFrame resolveMosaicLoopFrame(
  MosaicLoopMotion motion, {
  required int elapsedMilliseconds,
  required bool reducedMotion,
}) {
  _requireWholeElapsed(elapsedMilliseconds);
  final curve = _requireResolvedCurve(motion.curve);
  const rest = MosaicLoopFrame(
    complete: true,
    cycle: 0,
    cyclePhase: 0,
    excursion: 0,
    scale: 1,
    opacityMultiplier: 1,
  );
  // Reduced motion never leaves rest, and rest is the static rendering.
  if (reducedMotion) return rest;
  final cycleMilliseconds = curve.durationMilliseconds;
  final totalMilliseconds = cycleMilliseconds * motion.repeatCount;
  if (elapsedMilliseconds >= totalMilliseconds) {
    return MosaicLoopFrame(
      complete: true,
      cycle: motion.repeatCount,
      cyclePhase: 0,
      excursion: 0,
      scale: 1,
      opacityMultiplier: 1,
    );
  }
  final cycle = elapsedMilliseconds ~/ cycleMilliseconds;
  final cyclePhase =
      (elapsedMilliseconds - cycle * cycleMilliseconds) / cycleMilliseconds;
  // One pulse is an excursion out and back. The easing shapes each half, so the
  // excursion is 0 at both ends of every cycle — which is what makes a cycle
  // boundary and the terminal frame the same static rendering rather than two
  // near misses.
  final halfPhase = cyclePhase < 0.5 ? cyclePhase * 2 : (1 - cyclePhase) * 2;
  final excursion = mosaicEasedProgress(curve.easing, halfPhase);
  return MosaicLoopFrame(
    complete: false,
    cycle: cycle,
    cyclePhase: cyclePhase,
    excursion: excursion,
    scale: 1 + motion.scaleAmplitude * excursion,
    opacityMultiplier: 1 - motion.opacityAmplitude * excursion,
  );
}

bool _sameColorValue(MosaicColorValue from, MosaicColorValue to) =>
    from.value == to.value &&
    from.isLiteral == to.isLiteral &&
    from.isToken == to.isToken;

/// A colour interpolates only when both endpoints are canonical literals.
///
/// A semantic name resolves against the renderer's theme and a `colorToken`
/// resolves against the document, and neither has a numeric value the protocol
/// can average. Rather than invent one, the change applies at the half-way
/// point — the same rule a background *kind* change and a padding change
/// follow.
MosaicColorValue _interpolateColor(
  MosaicColorValue from,
  MosaicColorValue to,
  double progress,
) {
  if (_sameColorValue(from, to)) return to;
  if (!from.isLiteral || !to.isLiteral) return progress < 0.5 ? from : to;
  final buffer = StringBuffer('#');
  for (var offset = 1; offset < 9; offset += 2) {
    final start =
        int.parse(from.value.substring(offset, offset + 2), radix: 16);
    final end = int.parse(to.value.substring(offset, offset + 2), radix: 16);
    // Half-up, matching the reference resolver's `Math.round`. Channels are
    // never negative, so this is exact rather than merely close.
    final channel = (start + (end - start) * progress + 0.5).floor();
    buffer.write(channel.toRadixString(16).toUpperCase().padLeft(2, '0'));
  }
  return MosaicColorValue.parse(buffer.toString());
}

double _interpolateNumber(double from, double to, double progress) =>
    from + (to - from) * progress;

MosaicBackground _interpolateBackground(
  MosaicBackground from,
  MosaicBackground to,
  double progress,
) {
  if (from is MosaicColorBackground && to is MosaicColorBackground) {
    return MosaicColorBackground(
      _interpolateColor(from.color, to.color, progress),
    );
  }
  return progress < 0.5 ? from : to;
}

MosaicShadow? _interpolateShadow(
  MosaicShadow? from,
  MosaicShadow? to,
  double progress,
) {
  if (from is MosaicInlineShadow && to is MosaicInlineShadow) {
    return MosaicInlineShadow(
      color: _interpolateColor(from.color, to.color, progress),
      offsetX: _interpolateNumber(from.offsetX, to.offsetX, progress),
      offsetY: _interpolateNumber(from.offsetY, to.offsetY, progress),
      blurRadius: _interpolateNumber(from.blurRadius, to.blurRadius, progress),
    );
  }
  return progress < 0.5 ? from : to;
}

MosaicSelectionStateStyle _interpolateSelectionStyle(
  MosaicSelectionStateStyle from,
  MosaicSelectionStateStyle to,
  double progress,
) =>
    MosaicSelectionStateStyle(
      background: _interpolateBackground(
        from.background,
        to.background,
        progress,
      ),
      border: MosaicBorderStyle(
        color: _interpolateColor(from.border.color, to.border.color, progress),
        width: _interpolateNumber(from.border.width, to.border.width, progress),
      ),
      cornerRadius: _interpolateNumber(
        from.cornerRadius,
        to.cornerRadius,
        progress,
      ),
      // Padding changes the box the renderer is laying out, not the paint it is
      // applying. Interpolating it would relayout the subtree every frame on
      // three layout engines that disagree about when that is legal.
      padding: progress < 0.5 ? from.padding : to.padding,
      opacity: _interpolateNumber(from.opacity, to.opacity, progress),
      shadow: from.shadow == null && to.shadow == null
          ? null
          : _interpolateShadow(from.shadow, to.shadow, progress),
    );
