import SwiftUI

// The SwiftUI half of Protocol 0.4 motion. Every value drawn here comes from
// `MosaicMotionResolver`, which is the same code the conformance vectors are
// checked against — SwiftUI supplies a timeline, never a value.
//
// The terminal-state rule is structural rather than arithmetic: a frame that
// reports `isStatic` applies no modifier at all, so "the end of the animation"
// and "the static rendering" are not two code paths that must agree, they are
// one code path.

// MARK: - Applying a frame

extension View {
  @ViewBuilder
  fileprivate func mosaicAppearFrame(_ frame: MosaicAppearFrame) -> some View {
    if frame.isStatic {
      self
    } else {
      // The node travels *to* its laid-out position, so the remaining distance
      // is a positive downward offset that reaches exactly zero.
      opacity(frame.opacity).offset(y: frame.translateLogicalSize)
    }
  }

  @ViewBuilder
  fileprivate func mosaicLoopFrame(_ frame: MosaicLoopFrame) -> some View {
    if frame.isStatic {
      self
    } else {
      // `opacityAmplitude` is a fraction of the node's resolved static opacity,
      // so this composes multiplicatively over the appearance opacity rather
      // than replacing it: a node authored at 0.8 rests at 0.8.
      scaleEffect(frame.scale).opacity(frame.opacityMultiplier)
    }
  }
}

// MARK: - appear

/// Drives `appear` from an eased progress SwiftUI interpolates.
///
/// `Animatable` is what makes this work: SwiftUI hands the modifier every
/// intermediate value of `animatableData`, so the body recomputes per frame and
/// the protocol's value mapping runs on each one.
private struct MosaicAppearMotionModifier: ViewModifier, Animatable {
  var progress: Double
  let motion: MosaicAppearMotion
  let reducedMotion: Bool

  // `Animatable` is a nonisolated requirement and SwiftUI drives it off the
  // main actor's body evaluation, so the conformance is declared nonisolated
  // rather than inherited from the view's isolation.
  nonisolated var animatableData: Double {
    get { progress }
    set { progress = newValue }
  }

  func body(content: Content) -> some View {
    content.mosaicAppearFrame(
      MosaicMotionResolver.appearFrame(
        motion, easedProgress: progress, reducedMotion: reducedMotion)
    )
  }
}

/// One node's entrance.
///
/// Under reduced motion the transform is dropped and the opacity change is kept,
/// and the platform is allowed to shorten the remaining change — the contract
/// owns *what* changes, the platform owns *how long*.
@MainActor
struct MosaicAppearMotionView<Content: View>: View {
  @EnvironmentObject private var driver: MosaicMotionDriver
  @Environment(\.mosaicMotionAccessibility) private var accessibility
  @Environment(\.mosaicScreenEntry) private var screenEntry
  let motion: MosaicAppearMotion
  let curve: MosaicResolvedMotionCurve
  @ViewBuilder let content: () -> Content

  @State private var progress: Double = 0

  var body: some View {
    if !driver.isEnabled {
      content()
    } else if let elapsed = driver.elapsedMilliseconds {
      // Measured from this surface's entry rather than from the driver's
      // origin. The platform path gets the same origin from the view lifecycle:
      // a node that left the screen is rebuilt with `progress` back at zero.
      content().mosaicAppearFrame(controlledFrame(at: entryElapsed(elapsed)))
    } else {
      content()
        .modifier(
          MosaicAppearMotionModifier(
            progress: progress,
            motion: motion,
            reducedMotion: accessibility.prefersReducedMotion
          )
        )
        .onAppear {
          guard progress == 0 else { return }
          withAnimation(animation) { progress = 1 }
        }
    }
  }

  /// A driver instant re-expressed against this surface's entry. A surface with
  /// no recorded entry has not been navigated into and measures from the
  /// driver's own origin.
  private func entryElapsed(_ elapsed: Int) -> Int {
    screenEntry?.elapsedMilliseconds(at: elapsed) ?? elapsed
  }

  /// The frame is resolved from the elapsed time directly rather than from a
  /// progress derived here, so a controlled driver reproduces the published
  /// conformance vectors exactly rather than to within a second rounding.
  private func controlledFrame(at elapsed: Int) -> MosaicAppearFrame {
    (try? MosaicMotionResolver.appearFrame(
      motion,
      curve: curve,
      elapsedMilliseconds: elapsed,
      reducedMotion: accessibility.prefersReducedMotion
    )) ?? MosaicMotionResolver.terminalAppearFrame
  }

  private var animation: Animation {
    curve.animation.delay(Double(motion.delayMilliseconds) / 1000)
  }
}

// MARK: - selection

/// Supplies the interpolated box style for one selectable node.
///
/// A `View` conforming to `Animatable` re-evaluates its body for every
/// intermediate `progress`, which is how the closed interpolable field list —
/// including the fields that switch discretely at the half-way point — is
/// applied on a platform whose own animation system only knows how to
/// interpolate the values it recognises.
private struct MosaicSelectionMotionAnimator<Content: View>: View, Animatable {
  var progress: Double
  let from: MosaicSelectionStateStyle
  let to: MosaicSelectionStateStyle
  let reducedMotion: Bool
  @ViewBuilder let content: (MosaicSelectionStateStyle) -> Content

  // `Animatable` is a nonisolated requirement and SwiftUI drives it off the
  // main actor's body evaluation, so the conformance is declared nonisolated
  // rather than inherited from the view's isolation.
  nonisolated var animatableData: Double {
    get { progress }
    set { progress = newValue }
  }

  var body: some View {
    content(
      MosaicMotionResolver.selectionFrame(
        easedProgress: progress, reducedMotion: reducedMotion, from: from, to: to
      ).style
    )
  }
}

/// Paints a two-state selectable box, animating between the authored Default and
/// Selected styles when the component declares `selection` motion.
///
/// Both endpoints are authored styles, so progress `0` and progress `1` are both
/// exactly the static rendering: deselection is the same interpolation run
/// backwards rather than a second animation that could disagree with it.
@MainActor
struct MosaicSelectionStyledContent<Content: View>: View {
  @EnvironmentObject private var driver: MosaicMotionDriver
  @Environment(\.mosaicMotionAccessibility) private var accessibility
  let styles: MosaicSelectionStyles
  let selected: Bool
  let motion: MosaicSelectionMotion?
  let curve: MosaicResolvedMotionCurve?
  @ViewBuilder let content: (MosaicSelectionStateStyle) -> Content

  /// The driver time at which the selection last changed, so a controlled driver
  /// measures the interpolation from the change rather than from its origin.
  @State private var changedAtElapsed: Int?

  var body: some View {
    if let curve, driver.isEnabled, !accessibility.prefersReducedMotion, motion != nil {
      animated(curve: curve)
    } else {
      content(styles.resolving(selected: selected))
    }
  }

  @ViewBuilder
  private func animated(curve: MosaicResolvedMotionCurve) -> some View {
    if let elapsed = driver.elapsedMilliseconds {
      content(controlledFrame(at: elapsed, curve: curve).style)
        .onChange(of: selected) { _ in changedAtElapsed = driver.elapsedMilliseconds }
    } else {
      MosaicSelectionMotionAnimator(
        progress: selected ? 1 : 0,
        from: styles.defaultStyle,
        to: styles.selected.resolving(styles.defaultStyle),
        reducedMotion: accessibility.prefersReducedMotion,
        content: content
      )
      .animation(curve.animation, value: selected)
    }
  }

  private func controlledFrame(
    at elapsed: Int,
    curve: MosaicResolvedMotionCurve
  ) -> MosaicSelectionFrame {
    let selectedStyle = styles.selected.resolving(styles.defaultStyle)
    // Before the first selection change there is nothing to interpolate from:
    // the node has always looked like this.
    guard let changedAtElapsed else {
      return MosaicSelectionFrame(
        complete: true, progress: 1,
        style: selected ? selectedStyle : styles.defaultStyle)
    }
    let frame =
      (try? MosaicMotionResolver.selectionFrame(
        curve: curve,
        elapsedMilliseconds: max(0, elapsed - changedAtElapsed),
        reducedMotion: accessibility.prefersReducedMotion,
        from: selected ? styles.defaultStyle : selectedStyle,
        to: selected ? selectedStyle : styles.defaultStyle
      ))
    return frame
      ?? MosaicSelectionFrame(
        complete: true, progress: 1,
        style: selected ? selectedStyle : styles.defaultStyle)
  }
}

// MARK: - loop

/// A bounded call-to-action pulse.
///
/// The pulse is the one primitive whose timeline SwiftUI cannot own: a repeating
/// autoreversed animation leaves the animated value at its target rather than at
/// rest, which would strand a button permanently 4% too large. Driving it from a
/// clock and resolving each frame keeps the rest state exact, and keeps the
/// cycle boundaries — where the excursion is zero — exactly the static rendering.
@MainActor
struct MosaicLoopMotionView<Content: View>: View {
  @EnvironmentObject private var driver: MosaicMotionDriver
  @Environment(\.mosaicMotionAccessibility) private var accessibility
  @Environment(\.mosaicScreenEntry) private var screenEntry
  let motion: MosaicLoopMotion
  let curve: MosaicResolvedMotionCurve
  @ViewBuilder let content: () -> Content

  @State private var startedAt: Date?
  /// Set once the authored cycles have run, which stops the frame clock. The
  /// pulse is bounded, so a display-linked redraw that outlived it would burn a
  /// paywall's battery for the rest of the session drawing an unchanging frame.
  @State private var hasFinished = false

  var body: some View {
    if !driver.isEnabled || accessibility.prefersReducedMotion {
      // Reduced motion disables the loop entirely: the node sits at rest, which
      // is the static rendering.
      content()
    } else if let elapsed = driver.elapsedMilliseconds {
      // Same origin as the entrance, and the cycle bound is counted from it, so
      // the pulse is bounded per screen entry rather than per session.
      content().mosaicLoopFrame(frame(at: entryElapsed(elapsed)))
    } else {
      TimelineView(.animation(paused: hasFinished)) { context in
        let frame = frame(at: elapsedMilliseconds(at: context.date))
        content()
          .mosaicLoopFrame(frame)
          // Recorded outside body evaluation, where state may be written.
          .task(id: frame.complete) { hasFinished = hasFinished || frame.complete }
      }
      .onAppear { if startedAt == nil { startedAt = Date() } }
    }
  }

  /// A driver instant re-expressed against this surface's entry. A surface with
  /// no recorded entry has not been navigated into and measures from the
  /// driver's own origin.
  private func entryElapsed(_ elapsed: Int) -> Int {
    screenEntry?.elapsedMilliseconds(at: elapsed) ?? elapsed
  }

  private func elapsedMilliseconds(at date: Date) -> Int {
    guard let startedAt else { return 0 }
    return max(0, Int((date.timeIntervalSince(startedAt) * 1000).rounded(.down)))
  }

  private func frame(at elapsed: Int) -> MosaicLoopFrame {
    (try? MosaicMotionResolver.loopFrame(
      motion,
      curve: curve,
      elapsedMilliseconds: elapsed,
      reducedMotion: accessibility.prefersReducedMotion
    )) ?? MosaicMotionResolver.restingLoopFrame(cycle: motion.repeatCount)
  }
}

// MARK: - Attaching motion to a node

extension View {
  /// Wraps a node in its authored entrance, if it declares one and the curve
  /// resolves.
  ///
  /// An unresolvable curve renders the node statically rather than guessing a
  /// duration. The document could not have been accepted with one, so this is a
  /// belt on top of the validator's braces, not a fallback anyone should reach.
  @ViewBuilder
  @MainActor
  func mosaicAppearMotion(
    _ motion: MosaicMotion?,
    in document: MosaicPaywallDocument
  ) -> some View {
    if let appear = motion?.appear,
      let curve = document.resolvedMotionCurve(appear.curve)
    {
      MosaicAppearMotionView(motion: appear, curve: curve) { self }
    } else {
      self
    }
  }

  @ViewBuilder
  @MainActor
  func mosaicLoopMotion(
    _ motion: MosaicMotion?,
    in document: MosaicPaywallDocument
  ) -> some View {
    if let loop = motion?.loop,
      let curve = document.resolvedMotionCurve(loop.curve)
    {
      MosaicLoopMotionView(motion: loop, curve: curve) { self }
    } else {
      self
    }
  }
}
