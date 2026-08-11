import 'dart:async';

import 'package:flutter/scheduler.dart';
import 'package:flutter/widgets.dart';

/// Whether the platform is asking for reduced motion.
///
/// Injected at the renderer boundary exactly like the clock, so a test pins the
/// answer instead of reaching for a device setting. The protocol names
/// `MediaQuery.disableAnimationsOf` as Flutter's signal.
typedef MosaicReducedMotionSignal = bool Function(BuildContext context);

bool mosaicPlatformReducedMotion(BuildContext context) =>
    MediaQuery.disableAnimationsOf(context);

/// The elapsed time one animation is at.
///
/// One instance per running animation rather than one shared clock: entrances
/// start when their node enters, a selection transition starts when the
/// selection changes, and a pulse starts once per screen. A single shared
/// elapsed time could not express three different origins.
abstract interface class MosaicMotionTimeline implements Listenable {
  /// Time since [start] was last called.
  Duration get elapsed;

  /// Restarts from zero and begins notifying once per frame.
  void start();

  /// Stops notifying and leaves [elapsed] where it is.
  ///
  /// Every animation in the contract is bounded, so each one stops itself on
  /// reaching its terminal frame rather than notifying forever.
  void stop();

  void dispose();
}

/// A source that notifies once per interval.
///
/// Countdown is the only consumer: it needs a one-second rebuild of its own
/// text, not of the document.
abstract interface class MosaicMotionTicks implements Listenable {
  void dispose();
}

/// The injectable time source for everything in the renderer that changes on
/// its own: the three motion primitives, and the Countdown tick.
///
/// [enabled] is a single switch rather than one per feature because the thing
/// a caller wants is "nothing self-drives" — for a golden, for a screenshot
/// test, or for a host that renders the document statically. Disabled means
/// every animation renders at its terminal frame, which the protocol guarantees
/// is the static rendering, and the Countdown stops ticking. The Countdown's
/// displayed value still comes from the injected clock, so a disabled driver
/// changes when it repaints and never what it says.
abstract interface class MosaicMotionDriver {
  /// The default driver: animations run against the platform's frame clock.
  const factory MosaicMotionDriver() = _RealTimeMotionDriver;

  /// A driver that never advances. Static goldens are captured with this.
  const factory MosaicMotionDriver.disabled() = _DisabledMotionDriver;

  bool get enabled;

  /// A fresh elapsed-time source for one animation.
  MosaicMotionTimeline createTimeline(TickerProvider vsync);

  /// A fresh interval source. [interval] is one second for Countdown.
  MosaicMotionTicks createTicks(Duration interval);
}

final class _RealTimeMotionDriver implements MosaicMotionDriver {
  const _RealTimeMotionDriver();

  @override
  bool get enabled => true;

  @override
  MosaicMotionTimeline createTimeline(TickerProvider vsync) =>
      _TickerMotionTimeline(vsync);

  @override
  MosaicMotionTicks createTicks(Duration interval) =>
      _PeriodicMotionTicks(interval);
}

final class _DisabledMotionDriver implements MosaicMotionDriver {
  const _DisabledMotionDriver();

  @override
  bool get enabled => false;

  @override
  MosaicMotionTimeline createTimeline(TickerProvider vsync) =>
      _StoppedMotionTimeline();

  @override
  MosaicMotionTicks createTicks(Duration interval) => _StoppedMotionTicks();
}

final class _TickerMotionTimeline extends ChangeNotifier
    implements MosaicMotionTimeline {
  _TickerMotionTimeline(TickerProvider vsync) {
    _ticker = vsync.createTicker(_onTick);
  }

  late final Ticker _ticker;
  Duration _elapsed = Duration.zero;

  @override
  Duration get elapsed => _elapsed;

  void _onTick(Duration elapsed) {
    _elapsed = elapsed;
    notifyListeners();
  }

  @override
  void start() {
    if (_ticker.isActive) _ticker.stop();
    _elapsed = Duration.zero;
    _ticker.start();
  }

  @override
  void stop() {
    if (_ticker.isActive) _ticker.stop();
  }

  @override
  void dispose() {
    _ticker.dispose();
    super.dispose();
  }
}

final class _PeriodicMotionTicks extends ChangeNotifier
    implements MosaicMotionTicks {
  _PeriodicMotionTicks(Duration interval) {
    _timer = Timer.periodic(interval, (_) => notifyListeners());
  }

  late final Timer _timer;

  @override
  void dispose() {
    _timer.cancel();
    super.dispose();
  }
}

final class _StoppedMotionTimeline extends ChangeNotifier
    implements MosaicMotionTimeline {
  @override
  Duration get elapsed => Duration.zero;

  @override
  void start() {}

  @override
  void stop() {}
}

final class _StoppedMotionTicks extends ChangeNotifier
    implements MosaicMotionTicks {}
