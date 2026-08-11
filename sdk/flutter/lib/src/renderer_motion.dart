part of 'renderer.dart';

/// Plays a node's entrance once, then holds the static rendering.
///
/// The terminal frame is the static rendering exactly: opacity `1` and zero
/// remaining travel, reached by short-circuiting rather than by approaching, so
/// no accumulation of rounding can leave a price at `0.9999` opacity or a node
/// a fraction of a logical unit short of its laid-out position. Everything
/// animates *from* an offset *toward* the laid-out value and never past it.
///
/// The wrapper structure is deliberately fixed for the life of the scope rather
/// than collapsing to [child] on completion. Dropping a wrapper changes the
/// shape of the element chain, and Flutter rebuilds the subtree beneath a
/// changed chain from scratch — which would silently reset whatever state lives
/// under an animated node: a Carousel's page, a video controller, or a nested
/// pulse's own clock. Identity `Opacity` and `Transform` are pixel-identity
/// operations, and the golden that compares the terminal frame against the
/// static capture is what proves it.
final class MosaicAppearMotionScope extends StatefulWidget {
  const MosaicAppearMotionScope({
    required this.driver,
    required this.motion,
    required this.reducedMotion,
    required this.screenEntryCount,
    required this.child,
    super.key,
  });

  final MosaicMotionDriver driver;

  /// The authored entrance, with its curve already resolved to an inline
  /// motion. The frame resolvers refuse an unresolved token rather than
  /// inventing a duration nobody authored.
  final MosaicAppearMotion motion;
  final bool reducedMotion;

  /// How many times the node's screen has been entered.
  ///
  /// Node entry is the contract's time origin, and a screen the customer
  /// navigates back to is entered again. This renderer keeps the screen below
  /// a Sheet mounted, so mounting cannot be the signal — a change in this
  /// count is.
  final int screenEntryCount;
  final Widget child;

  @override
  State<MosaicAppearMotionScope> createState() =>
      _MosaicAppearMotionScopeState();
}

final class _MosaicAppearMotionScopeState extends State<MosaicAppearMotionScope>
    with SingleTickerProviderStateMixin {
  MosaicMotionTimeline? _timeline;

  /// Whether this entrance ever moves the node.
  ///
  /// Under reduced motion no transform occurs at all — not a shortened one and
  /// not a zero-length one — so the transform is absent from the structure
  /// rather than driven to zero.
  bool get _translates =>
      widget.motion.effect == MosaicAppearEffect.fadeRise &&
      !widget.reducedMotion;

  @override
  void initState() {
    super.initState();
    if (!widget.driver.enabled) return;
    _timeline = widget.driver.createTimeline(this)..start();
  }

  @override
  void didUpdateWidget(MosaicAppearMotionScope oldWidget) {
    super.didUpdateWidget(oldWidget);
    // The clock is restarted rather than the scope being re-keyed. Re-keying
    // would rebuild the subtree from scratch and silently reset the state
    // under it — a Carousel's page, a Tabs selection, a video controller —
    // none of which a screen re-entry is supposed to touch.
    if (oldWidget.screenEntryCount == widget.screenEntryCount) return;
    _timeline?.start();
  }

  @override
  void dispose() {
    _timeline?.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final timeline = _timeline;
    // A disabled driver renders the terminal frame, which is the static
    // rendering, so there is nothing to wrap.
    if (timeline == null) return widget.child;
    return ListenableBuilder(
      listenable: timeline,
      builder: (context, child) {
        final frame = resolveMosaicAppearFrame(
          widget.motion,
          elapsedMilliseconds: timeline.elapsed.inMilliseconds,
          reducedMotion: widget.reducedMotion,
        );
        // Stop after the frame, not during it: a Ticker cannot be stopped from
        // inside its own callback.
        if (frame.complete) _stopAfterFrame(timeline);
        final faded = Opacity(
          key: const ValueKey<String>('mosaic-appear-opacity'),
          opacity: frame.opacity,
          child: child,
        );
        if (!_translates) return faded;
        return Transform.translate(
          key: const ValueKey<String>('mosaic-appear-translate'),
          offset: Offset(0, frame.translateLogicalSize),
          child: faded,
        );
      },
      child: widget.child,
    );
  }
}

/// Pulses a Button a bounded number of times, then rests permanently.
///
/// Rest is scale `1` and opacity multiplier `1`, which composes with the node's
/// resolved static opacity to exactly that opacity — so a node that authored
/// `appearance.opacity: 0.8` rests at `0.8`, not at `1.0`.
final class MosaicLoopMotionScope extends StatefulWidget {
  const MosaicLoopMotionScope({
    required this.driver,
    required this.motion,
    required this.reducedMotion,
    required this.screenEntryCount,
    required this.child,
    super.key,
  });

  final MosaicMotionDriver driver;
  final MosaicLoopMotion motion;
  final bool reducedMotion;

  /// How many times the node's screen has been entered.
  ///
  /// The authored cycle bound is spent **per screen entry**, not once for the
  /// life of the paywall: a customer who leaves for a detail screen and comes
  /// back is entering the screen again, and sees the pulse again.
  final int screenEntryCount;
  final Widget child;

  @override
  State<MosaicLoopMotionScope> createState() => _MosaicLoopMotionScopeState();
}

final class _MosaicLoopMotionScopeState extends State<MosaicLoopMotionScope>
    with SingleTickerProviderStateMixin {
  MosaicMotionTimeline? _timeline;

  @override
  void initState() {
    super.initState();
    // Reduced motion disables the loop entirely: the node sits at rest, which
    // is the static rendering, so there is nothing to drive and nothing to
    // wrap.
    if (!widget.driver.enabled || widget.reducedMotion) return;
    _timeline = widget.driver.createTimeline(this)..start();
  }

  @override
  void didUpdateWidget(MosaicLoopMotionScope oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.screenEntryCount == widget.screenEntryCount) return;
    _timeline?.start();
  }

  @override
  void dispose() {
    _timeline?.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final timeline = _timeline;
    if (timeline == null) return widget.child;
    return ListenableBuilder(
      listenable: timeline,
      builder: (context, child) {
        final frame = resolveMosaicLoopFrame(
          widget.motion,
          elapsedMilliseconds: timeline.elapsed.inMilliseconds,
          reducedMotion: widget.reducedMotion,
        );
        if (frame.complete) _stopAfterFrame(timeline);
        return Transform.scale(
          key: const ValueKey<String>('mosaic-loop-scale'),
          scale: frame.scale,
          child: Opacity(
            key: const ValueKey<String>('mosaic-loop-opacity'),
            opacity: frame.opacityMultiplier,
            child: child,
          ),
        );
      },
      child: widget.child,
    );
  }
}

/// Interpolates a two-state selectable box between its Default and Selected
/// styles when the runtime selection changes.
///
/// [selected] is the trigger rather than the resolved style, because the
/// protocol animates *a selection change* — the resolved style is a fresh
/// object on every build and could not tell a change from a rebuild.
final class MosaicSelectionMotionScope extends StatefulWidget {
  const MosaicSelectionMotionScope({
    required this.driver,
    required this.motion,
    required this.reducedMotion,
    required this.selected,
    required this.styles,
    required this.builder,
    super.key,
  });

  final MosaicMotionDriver driver;
  final MosaicSelectionMotion motion;
  final bool reducedMotion;
  final bool selected;
  final MosaicSelectionStyles styles;
  final Widget Function(BuildContext, MosaicSelectionStateStyle) builder;

  @override
  State<MosaicSelectionMotionScope> createState() =>
      _MosaicSelectionMotionScopeState();
}

final class _MosaicSelectionMotionScopeState
    extends State<MosaicSelectionMotionScope>
    with SingleTickerProviderStateMixin {
  /// Created once and never swapped, so the element chain under this scope is
  /// stable across a selection change and the card's subtree is not rebuilt
  /// from scratch every time the customer picks a different plan.
  late final MosaicMotionTimeline _timeline =
      widget.driver.createTimeline(this);
  MosaicSelectionStateStyle? _from;

  MosaicSelectionStateStyle get _target =>
      widget.styles.resolve(selected: widget.selected);

  @override
  void didUpdateWidget(MosaicSelectionMotionScope oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.selected == widget.selected) return;
    if (!widget.driver.enabled || widget.reducedMotion) {
      // Reduced motion applies the selected style instantly: the frame at every
      // elapsed time is the resolved Selected style exactly.
      _from = null;
      _timeline.stop();
      return;
    }
    // A change arriving mid-transition starts from what is on screen, not from
    // the style the previous transition began at.
    _from = _displayedStyle(oldWidget);
    _timeline.start();
  }

  MosaicSelectionStateStyle _displayedStyle(
    MosaicSelectionMotionScope previous,
  ) {
    final from = _from;
    final previousTarget = previous.styles.resolve(selected: previous.selected);
    if (from == null) return previousTarget;
    return resolveMosaicSelectionFrame(
      widget.motion,
      elapsedMilliseconds: _timeline.elapsed.inMilliseconds,
      reducedMotion: false,
      resolvedFrom: from,
      resolvedTo: previousTarget,
    ).style;
  }

  @override
  void dispose() {
    _timeline.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return ListenableBuilder(
      listenable: _timeline,
      builder: (context, _) {
        final from = _from;
        if (from == null) return widget.builder(context, _target);
        final frame = resolveMosaicSelectionFrame(
          widget.motion,
          elapsedMilliseconds: _timeline.elapsed.inMilliseconds,
          reducedMotion: widget.reducedMotion,
          resolvedFrom: from,
          resolvedTo: _target,
        );
        if (frame.complete) _stopAfterFrame(_timeline);
        return widget.builder(context, frame.style);
      },
    );
  }
}

/// Rebuilds only its own subtree when [ticks] fires.
///
/// Countdown's one-second tick used to run a `setState` on the paywall root,
/// which rebuilt every node in the document once a second to advance one line
/// of text. This scopes that rebuild to the widgets whose content actually
/// depends on the second hand.
final class MosaicTickBuilder extends StatelessWidget {
  const MosaicTickBuilder({
    required this.ticks,
    required this.builder,
    super.key,
  });

  final MosaicMotionTicks? ticks;
  final WidgetBuilder builder;

  @override
  Widget build(BuildContext context) {
    final ticks = this.ticks;
    if (ticks == null) return builder(context);
    return ListenableBuilder(
      listenable: ticks,
      builder: (context, _) => builder(context),
    );
  }
}

/// Stops [timeline] once the frame that reached the terminal state is on
/// screen.
///
/// A bounded animation that kept notifying would leave the tree permanently
/// dirty, which starves `pumpAndSettle` in host tests and burns frames in a
/// shipped app for a node that is no longer moving.
void _stopAfterFrame(MosaicMotionTimeline timeline) {
  WidgetsBinding.instance.addPostFrameCallback((_) => timeline.stop());
}
