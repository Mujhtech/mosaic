import Foundation
import XCTest

@testable import MosaicSDK

/// The motion driver, the three primitives driven through it, and the reduced
/// motion contract.
///
/// The SDK has no scheduler to wind forward, so these drive the driver's elapsed
/// source explicitly. That is the whole reason the driver exists: without it the
/// only way to ask "what is on screen at t = 120 ms" would be to sleep and hope.
@MainActor
final class MotionDriverTests: XCTestCase {

  // MARK: - The driver

  /// Protects the injection contract itself. A controlled driver must not move
  /// unless it is told to, and a platform driver must not be movable by a test
  /// that thinks it is controlling one — either confusion would make every
  /// motion assertion below meaningless.
  func testDriverAdvancesOnlyWhenItOwnsItsTime() {
    let controlled = MosaicMotionDriver.controlled()
    XCTAssertTrue(controlled.isControlled)
    XCTAssertEqual(controlled.elapsedMilliseconds, 0)

    controlled.advance(to: 120)
    XCTAssertEqual(controlled.elapsedMilliseconds, 120)
    controlled.advance(by: 40)
    XCTAssertEqual(controlled.elapsedMilliseconds, 160)

    // A caller's arithmetic slip must not hand the resolver a clock it would
    // throw on, inside a host application.
    controlled.advance(to: -50)
    XCTAssertEqual(controlled.elapsedMilliseconds, 0)

    let platform = MosaicMotionDriver.platform()
    XCTAssertFalse(platform.isControlled)
    XCTAssertNil(platform.elapsedMilliseconds)
    platform.advance(to: 500)
    XCTAssertNil(platform.elapsedMilliseconds)

    let disabled = MosaicMotionDriver.disabled()
    XCTAssertFalse(disabled.isEnabled)
  }

  /// The Countdown's redraw cadence is the driver's, so it can be stepped.
  ///
  /// Protects the behaviour the wall-clock `TimelineView(.periodic(by: 1))`
  /// made untestable: a tick is now an observable event rather than a second of
  /// real time. The countdown's *value* still comes from the injected clock, and
  /// its rounding is deliberately not touched here.
  func testCountdownCadenceIsAnObservableTickRatherThanWallClockTime() async {
    let driver = MosaicMotionDriver.controlled()
    XCTAssertEqual(driver.tickCount, 0)
    driver.tick()
    driver.advance(by: 1_000)
    XCTAssertEqual(driver.tickCount, 2)

    // A controlled driver never starts the platform cadence: a background loop
    // that ticked anyway would make a test's rendering depend on how long the
    // test took to run.
    await driver.runCadence(intervalNanoseconds: 1)
    XCTAssertEqual(driver.tickCount, 2)
  }

  // MARK: - appear

  /// Protects the entrance's authored shape: the delay holds the node at the
  /// start frame, the rise is consumed on the way in, and the end is the static
  /// rendering. Driving elapsed time directly is what makes each of those a
  /// separate, checkable instant.
  func testAppearHoldsThroughItsDelayThenTravelsToItsStaticPosition() throws {
    let curve = MosaicResolvedMotionCurve(durationMilliseconds: 200, easing: .linear)
    let motion = MosaicAppearMotion(
      effect: .fadeRise, riseLogicalSize: 12, curve: .inline(curve), delayMilliseconds: 80)

    func frame(_ elapsed: Int) throws -> MosaicAppearFrame {
      try MosaicMotionResolver.appearFrame(
        motion, curve: curve, elapsedMilliseconds: elapsed, reducedMotion: false)
    }

    // Held: nothing has started, and the node waits the full rise away.
    for elapsed in [0, 40, 80] {
      XCTAssertEqual(try frame(elapsed).opacity, 0)
      XCTAssertEqual(try frame(elapsed).translateLogicalSize, 12)
      XCTAssertFalse(try frame(elapsed).isStatic)
    }
    // Half way through the curve, half way in and half way down.
    XCTAssertEqual(try frame(180).opacity, 0.5, accuracy: 1e-9)
    XCTAssertEqual(try frame(180).translateLogicalSize, 6, accuracy: 1e-9)
    // The end, and everything past it, is the static rendering exactly.
    for elapsed in [280, 281, 10_000] {
      XCTAssertTrue(try frame(elapsed).isStatic)
      XCTAssertEqual(try frame(elapsed).opacity, 1)
      XCTAssertEqual(try frame(elapsed).translateLogicalSize, 0)
    }
  }

  /// Protects the reduced-motion ruling for `appear`: opacity only, with the
  /// transform dropped *at every instant including the first frame*, and a
  /// terminal state unchanged from the unreduced one.
  func testReducedMotionAppearDropsTheTransformAndKeepsTheFade() throws {
    let curve = MosaicResolvedMotionCurve(durationMilliseconds: 240, easing: .decelerate)
    let motion = MosaicAppearMotion(
      effect: .fadeRise, riseLogicalSize: 12, curve: .inline(curve), delayMilliseconds: 0)

    for elapsed in [0, 60, 120, 180] {
      let frame = try MosaicMotionResolver.appearFrame(
        motion, curve: curve, elapsedMilliseconds: elapsed, reducedMotion: true)
      XCTAssertEqual(frame.translateLogicalSize, 0, "t=\(elapsed)")
      let unreduced = try MosaicMotionResolver.appearFrame(
        motion, curve: curve, elapsedMilliseconds: elapsed, reducedMotion: false)
      XCTAssertEqual(frame.opacity, unreduced.opacity, "t=\(elapsed)")
    }

    let terminal = try MosaicMotionResolver.appearFrame(
      motion, curve: curve, elapsedMilliseconds: 240, reducedMotion: true)
    XCTAssertTrue(terminal.isStatic)
  }

  // MARK: - selection

  /// Protects the closed interpolable field list, which is the part of the
  /// contract a renderer is most likely to get wrong by being helpful: a literal
  /// colour interpolates, a semantic one does not, and padding switches at the
  /// half-way point rather than relayouting every frame.
  func testSelectionInterpolatesOnlyTheClosedFieldList() throws {
    let curve = MosaicResolvedMotionCurve(durationMilliseconds: 100, easing: .linear)
    let from = MosaicSelectionStateStyle(
      background: .color(.literal("#000000FF")),
      border: MosaicBorder(color: .semantic(.borderDefault), width: 1),
      cornerRadius: 10,
      padding: MosaicEdgeInsets(top: 10, start: 10, bottom: 10, end: 10),
      opacity: 0.5,
      shadow: nil
    )
    let to = MosaicSelectionStateStyle(
      background: .color(.literal("#FFFFFFFF")),
      border: MosaicBorder(color: .semantic(.actionPrimary), width: 3),
      cornerRadius: 20,
      padding: MosaicEdgeInsets(top: 20, start: 20, bottom: 20, end: 20),
      opacity: 1,
      shadow: nil
    )

    func style(_ elapsed: Int, reduced: Bool = false) throws -> MosaicSelectionStateStyle {
      try MosaicMotionResolver.selectionFrame(
        curve: curve, elapsedMilliseconds: elapsed, reducedMotion: reduced, from: from, to: to
      ).style
    }

    // Just before the half-way point the discrete fields still read Default.
    let early = try style(49)
    XCTAssertEqual(early.background, .color(.literal("#7D7D7DFF")))
    XCTAssertEqual(early.border.color, .semantic(.borderDefault))
    XCTAssertEqual(early.padding, from.padding)
    XCTAssertEqual(early.border.width, 1.98, accuracy: 1e-9)
    XCTAssertEqual(early.cornerRadius, 14.9, accuracy: 1e-9)
    XCTAssertEqual(early.opacity, 0.745, accuracy: 1e-9)

    // At it, they switch — all of them, together.
    let mid = try style(50)
    XCTAssertEqual(mid.border.color, .semantic(.actionPrimary))
    XCTAssertEqual(mid.padding, to.padding)
    XCTAssertEqual(mid.background, .color(.literal("#808080FF")))

    // The end is the resolved Selected style, byte for byte.
    XCTAssertEqual(try style(100), to)
    XCTAssertEqual(try style(10_000), to)
    // Under reduced motion every instant is that same terminal style.
    XCTAssertEqual(try style(0, reduced: true), to)
    XCTAssertEqual(try style(50, reduced: true), to)
  }

  /// A background *kind* change has no average, so it switches rather than being
  /// invented. Protects against a renderer that tries to cross-fade a gradient
  /// into a colour and produces something nobody authored.
  func testSelectionSwitchesBackgroundKindDiscretely() throws {
    let curve = MosaicResolvedMotionCurve(durationMilliseconds: 100, easing: .linear)
    let gradient = MosaicBackground.linearGradient(
      angle: 0,
      stops: [
        MosaicGradientStop(position: 0, color: .literal("#000000FF")),
        MosaicGradientStop(position: 1, color: .literal("#FFFFFFFF")),
      ]
    )
    let from = MosaicSelectionStateStyle(
      background: .color(.literal("#000000FF")),
      border: MosaicBorder(color: .literal("#000000FF"), width: 1),
      cornerRadius: 0,
      padding: .zero,
      opacity: 1,
      shadow: nil
    )
    let to = MosaicSelectionStateStyle(
      background: gradient,
      border: from.border,
      cornerRadius: 0,
      padding: .zero,
      opacity: 1,
      shadow: nil
    )
    func background(_ elapsed: Int) throws -> MosaicBackground {
      try MosaicMotionResolver.selectionFrame(
        curve: curve, elapsedMilliseconds: elapsed, reducedMotion: false, from: from, to: to
      ).style.background
    }
    XCTAssertEqual(try background(49), from.background)
    XCTAssertEqual(try background(50), gradient)
  }

  // MARK: - loop

  /// Protects every flash-safety property the pulse claims: it returns to rest
  /// at each cycle boundary, it peaks at the half cycle, it stops after the
  /// authored count, and it never leaves the node scaled or dimmed afterwards.
  func testPulseReturnsToRestAtEveryCycleBoundaryAndStopsPermanently() throws {
    let curve = MosaicResolvedMotionCurve(durationMilliseconds: 600, easing: .linear)
    let motion = try loopMotion(
      scaleAmplitude: 0.04, opacityAmplitude: 0.12, repeatCount: 3, curve: curve)

    func frame(_ elapsed: Int) throws -> MosaicLoopFrame {
      try MosaicMotionResolver.loopFrame(
        motion, curve: curve, elapsedMilliseconds: elapsed, reducedMotion: false)
    }

    for boundary in [0, 600, 1_200] {
      XCTAssertEqual(try frame(boundary).excursion, 0, "cycle boundary \(boundary)")
      XCTAssertTrue(try frame(boundary).isStatic, "cycle boundary \(boundary)")
    }
    // The excursion peaks half way through a cycle, out and back.
    let peak = try frame(300)
    XCTAssertEqual(peak.excursion, 1, accuracy: 1e-9)
    XCTAssertEqual(peak.scale, 1.04, accuracy: 1e-9)
    XCTAssertEqual(peak.opacityMultiplier, 0.88, accuracy: 1e-9)
    XCTAssertEqual(peak.cycle, 0)
    XCTAssertEqual(try frame(900).cycle, 1)

    // Three cycles, then permanent rest. A bounded count needs no stop control
    // because it stops.
    for elapsed in [1_800, 1_801, 60_000] {
      let rest = try frame(elapsed)
      XCTAssertTrue(rest.complete, "t=\(elapsed)")
      XCTAssertEqual(rest.scale, 1)
      XCTAssertEqual(rest.opacityMultiplier, 1)
      XCTAssertEqual(rest.cycle, 3)
    }
  }

  /// Protects the reduced-motion ruling for `loop`: fully disabled, at rest,
  /// from the first instant — not a shortened or gentler pulse.
  func testReducedMotionDisablesTheLoopEntirely() throws {
    let curve = MosaicResolvedMotionCurve(durationMilliseconds: 900, easing: .standard)
    let motion = try loopMotion(
      scaleAmplitude: 0.06, opacityAmplitude: 0.2, repeatCount: 5, curve: curve)
    for elapsed in [0, 225, 450, 4_500] {
      let frame = try MosaicMotionResolver.loopFrame(
        motion, curve: curve, elapsedMilliseconds: elapsed, reducedMotion: true)
      XCTAssertTrue(frame.isStatic, "t=\(elapsed)")
      XCTAssertTrue(frame.complete)
      XCTAssertEqual(frame.cycle, 0)
    }
  }

  // MARK: - One origin per node

  /// A Button carrying both `appear` and `loop` runs both clocks from node
  /// entry, and the two compose on the node's own values.
  ///
  /// Protects the ruling the frame vectors structurally cannot: `resolveV04MotionFrame`
  /// takes one trigger and one elapsed time, so it describes each primitive in
  /// isolation and is silent about what `t = 0` is measured from. The tempting
  /// alternative — start the pulse when the entrance finishes — would make one
  /// trigger's origin a function of another trigger's delay plus its resolved
  /// curve, which is exactly the cross-trigger arithmetic three renderers get
  /// subtly different. Driving the controlled driver to a single instant
  /// mid-entrance is what makes the difference observable: at that instant the
  /// two answers differ, and only one of them is the contract's.
  func testAppearAndLoopOnOneButtonShareTheNodeEntryOrigin() throws {
    // The canonical purchase Button already carries both, with a non-zero
    // entrance delay. Only its static opacity is changed, so the composition
    // below has three distinguishable factors instead of two and a `1`.
    let staticOpacity = 0.8
    var object = try XCTUnwrap(
      JSONSerialization.jsonObject(with: v04FixtureData()) as? [String: Any])
    try mutateV03Node(id: "purchase", in: &object) { node in
      var appearance = (node["appearance"] as? [String: Any]) ?? [:]
      appearance["opacity"] = staticOpacity
      node["appearance"] = appearance
    }
    let document = try MosaicProtocolDecoder.decode(
      JSONSerialization.data(withJSONObject: object, options: [.sortedKeys]))

    guard case .button(let button)? = document.allNodes.first(where: { $0.id == "purchase" })
    else { return XCTFail("Expected the canonical purchase button.") }
    let appear = try XCTUnwrap(button.motion?.appear)
    let loop = try XCTUnwrap(button.motion?.loop)
    let appearCurve = try XCTUnwrap(document.resolvedMotionCurve(appear.curve))
    let loopCurve = try XCTUnwrap(document.resolvedMotionCurve(loop.curve))
    XCTAssertEqual(button.appearance?.opacity, staticOpacity)
    // The entrance is held for 240 ms and then runs for 240 ms.
    XCTAssertEqual(appear.delayMilliseconds, 240)
    XCTAssertEqual(appearCurve.durationMilliseconds, 240)
    XCTAssertEqual(loopCurve.durationMilliseconds, 900)

    // One driver, one origin: node entry. This is what the renderer reads for
    // both primitives in controlled mode.
    let driver = MosaicMotionDriver.controlled()
    driver.advance(to: 360)
    let elapsed = try XCTUnwrap(driver.elapsedMilliseconds)

    let appearFrame = try MosaicMotionResolver.appearFrame(
      appear, curve: appearCurve, elapsedMilliseconds: elapsed, reducedMotion: false)
    let loopFrame = try MosaicMotionResolver.loopFrame(
      loop, curve: loopCurve, elapsedMilliseconds: elapsed, reducedMotion: false)

    // Mid-entrance: started, not finished.
    XCTAssertFalse(appearFrame.isStatic)
    XCTAssertGreaterThan(appearFrame.progress, 0)
    XCTAssertLessThan(appearFrame.progress, 1)

    // And the pulse has been running the whole time, measured from node entry:
    // 360 of a 900 ms cycle is four tenths of the way through the first one.
    XCTAssertFalse(loopFrame.isStatic)
    XCTAssertGreaterThan(loopFrame.scale, 1)
    XCTAssertLessThan(loopFrame.opacityMultiplier, 1)
    XCTAssertEqual(loopFrame.cycle, 0)
    XCTAssertEqual(loopFrame.cyclePhase, 0.4, accuracy: 1e-9)

    // Had the pulse waited for the entrance to finish, it would not have started
    // at all by this instant — the entrance ends at 480 ms and it is now 360 ms.
    // Its clock would still be at its origin: at rest, indistinguishable from a
    // node carrying no loop.
    let entranceEnd = appear.delayMilliseconds + appearCurve.durationMilliseconds
    XCTAssertGreaterThan(entranceEnd, elapsed)
    let hadItWaited = try MosaicMotionResolver.loopFrame(
      loop,
      curve: loopCurve,
      elapsedMilliseconds: max(0, elapsed - entranceEnd),
      reducedMotion: false
    )
    XCTAssertTrue(hadItWaited.isStatic)
    XCTAssertNotEqual(loopFrame.scale, hadItWaited.scale)

    // opacity = resolvedStaticOpacity × appearProgress × loopOpacityMultiplier.
    // The renderer composes exactly this product: the entrance's opacity is
    // applied to the node, the pulse's multiplier inside it, and the authored
    // appearance opacity inside that — one node's own values, at one place.
    let composed = staticOpacity * appearFrame.opacity * loopFrame.opacityMultiplier
    XCTAssertLessThan(composed, staticOpacity * appearFrame.opacity)
    XCTAssertLessThan(composed, staticOpacity * loopFrame.opacityMultiplier)
    // Recomputed from the published excursion, which is itself rounded to four
    // decimals, so this agrees to the contract's stated tolerance rather than to
    // the last bit — the resolver rounds the product, this rounds a factor.
    XCTAssertEqual(
      composed,
      staticOpacity * appearFrame.opacity * (1 - loop.opacityAmplitude * loopFrame.excursion),
      accuracy: 1e-3
    )
    // scale = loopScale. The entrance contributes a translation and the pulse a
    // scale, and neither reads the other; this entrance is a `fade`, so it
    // contributes no translation either.
    XCTAssertEqual(appearFrame.translateLogicalSize, 0)
    XCTAssertEqual(loopFrame.scale, 1 + loop.scaleAmplitude * loopFrame.excursion, accuracy: 1e-3)

    // Both converge on the static rendering, so the composition ends there too.
    driver.advance(to: loopCurve.durationMilliseconds * loop.repeatCount)
    let endElapsed = try XCTUnwrap(driver.elapsedMilliseconds)
    let appearEnd = try MosaicMotionResolver.appearFrame(
      appear, curve: appearCurve, elapsedMilliseconds: endElapsed, reducedMotion: false)
    let loopEnd = try MosaicMotionResolver.loopFrame(
      loop, curve: loopCurve, elapsedMilliseconds: endElapsed, reducedMotion: false)
    XCTAssertTrue(appearEnd.isStatic)
    XCTAssertTrue(loopEnd.isStatic)
    XCTAssertEqual(
      staticOpacity * appearEnd.opacity * loopEnd.opacityMultiplier, staticOpacity)
    XCTAssertEqual(loopEnd.scale, 1)
  }

  // MARK: - Screen re-entry

  /// A screen the customer left and returned to plays its entrances again, and
  /// the bounded pulse spends its cycles again, both measured from the new entry.
  ///
  /// Protects the node-entry origin across navigation, which the existing
  /// coverage could not reach: every other motion test starts at the driver's
  /// origin, where "since node entry" and "since the driver started" are the same
  /// number. They diverge only after a re-entry, and the closing assertions pin
  /// that divergence — at the instant checked, a renderer that kept measuring
  /// from the driver's origin would show the static rendering, so dropping the
  /// entry origin fails this test rather than merely making it redundant.
  ///
  /// The canonical fixture's second screen is a sheet, which is presented *over*
  /// the offer screen and leaves its nodes in place. Promoting it to a full
  /// screen is the smallest change that makes the purchase button genuinely
  /// leave; the sheet case is the counterpart test below.
  func testEntranceAndPulseReplayFromNodeEntryWhenAScreenIsReEntered() throws {
    let document = try v04DocumentWithDetailsAsAFullScreen()
    let model = MosaicPaywallModel(
      document: document,
      purchaseProvider: MockMosaicPurchaseProvider(products: MosaicProduct.phase1MockProducts),
      onResult: { _ in }
    )
    guard case .button(let button)? = document.allNodes.first(where: { $0.id == "purchase" })
    else { return XCTFail("Expected the canonical purchase button.") }
    let appear = try XCTUnwrap(button.motion?.appear)
    let loop = try XCTUnwrap(button.motion?.loop)
    let appearCurve = try XCTUnwrap(document.resolvedMotionCurve(appear.curve))
    let loopCurve = try XCTUnwrap(document.resolvedMotionCurve(loop.curve))

    let driver = MosaicMotionDriver.controlled()
    // Exactly what the two controlled-mode motion views read.
    func frames(at driverTime: Int) throws -> (MosaicAppearFrame, MosaicLoopFrame) {
      driver.advance(to: driverTime)
      let elapsed = driver.nodeElapsedMilliseconds(at: try XCTUnwrap(driver.elapsedMilliseconds))
      return (
        try MosaicMotionResolver.appearFrame(
          appear, curve: appearCurve, elapsedMilliseconds: elapsed, reducedMotion: false),
        try MosaicMotionResolver.loopFrame(
          loop, curve: loopCurve, elapsedMilliseconds: elapsed, reducedMotion: false)
      )
    }

    driver.enterScreen(model.baseScreen?.id)
    XCTAssertEqual(model.baseScreen?.id, "offer")
    XCTAssertEqual(driver.screenEntryCount, 1)

    let (entering, pulsing) = try frames(at: 360)
    XCTAssertFalse(entering.isStatic)
    XCTAssertFalse(pulsing.isStatic)
    XCTAssertEqual(pulsing.cycle, 0)

    // Both settle, and the pulse spends its authored cycles.
    let exhausted =
      appear.delayMilliseconds + appearCurve.durationMilliseconds
      + loopCurve.durationMilliseconds * loop.repeatCount
    let (settled, rested) = try frames(at: exhausted)
    XCTAssertTrue(settled.isStatic)
    XCTAssertTrue(rested.isStatic)

    // Re-rendering the screen already on show is not an entry. Only a change is.
    driver.enterScreen(model.baseScreen?.id)
    XCTAssertEqual(driver.screenEntryCount, 1)

    model.navigate(to: "details")
    driver.advance(to: 4_000)
    driver.enterScreen(model.baseScreen?.id)
    XCTAssertEqual(model.baseScreen?.id, "details")

    model.navigateBack()
    driver.advance(to: 5_000)
    driver.enterScreen(model.baseScreen?.id)
    XCTAssertEqual(model.baseScreen?.id, "offer")
    XCTAssertEqual(driver.screenEntryCount, 3)
    XCTAssertEqual(driver.screenEntryElapsedMilliseconds, 5_000)

    // The same offset into the new entry is the same frame as the first time.
    let (replayedEntrance, replayedPulse) = try frames(at: 5_360)
    XCTAssertEqual(replayedEntrance.opacity, entering.opacity)
    XCTAssertEqual(replayedEntrance.translateLogicalSize, entering.translateLogicalSize)
    XCTAssertEqual(replayedPulse.scale, pulsing.scale)
    XCTAssertEqual(replayedPulse.opacityMultiplier, pulsing.opacityMultiplier)
    // The bound is per screen entry, not per session: the pulse is in its first
    // cycle again rather than permanently spent.
    XCTAssertEqual(replayedPulse.cycle, 0)

    // Measured from the driver's origin instead, both would be static — which is
    // what makes the assertions above a test of the entry origin.
    XCTAssertTrue(
      try MosaicMotionResolver.appearFrame(
        appear, curve: appearCurve, elapsedMilliseconds: 5_360, reducedMotion: false
      ).isStatic)
    XCTAssertTrue(
      try MosaicMotionResolver.loopFrame(
        loop, curve: loopCurve, elapsedMilliseconds: 5_360, reducedMotion: false
      ).isStatic)
  }

  /// Presenting and dismissing a sheet is not a screen entry: the screen behind
  /// it keeps its motion state, so its entrances do not replay and its pulse
  /// budget does not reset.
  ///
  /// Protects the other half of "genuine", in two places it can be lost. The
  /// obvious *wiring* mistake is keying the origin on the current screen, which
  /// replays the whole paywall every time a details sheet closes. The subtler one
  /// is structural, and Compose shipped it: building the background screen from
  /// two call sites in two branches gives it two identities, so presenting the
  /// sheet tears the first down and rebuilds the second with fresh state — the
  /// entrance replays and the bounded pulse starts its cycles over, with the
  /// origin wired perfectly correctly. SwiftUI builds the base surface from one
  /// unconditional call site and presents the sheet's own surface beside it, so
  /// the background screen is never rebuilt; these assertions hold it there.
  func testPresentingAndDismissingASheetIsNotAScreenReEntry() throws {
    let document = try v04Document()
    let model = MosaicPaywallModel(
      document: document,
      purchaseProvider: MockMosaicPurchaseProvider(products: MosaicProduct.phase1MockProducts),
      onResult: { _ in }
    )
    guard case .button(let button)? = document.allNodes.first(where: { $0.id == "purchase" })
    else { return XCTFail("Expected the canonical purchase button.") }
    let appear = try XCTUnwrap(button.motion?.appear)
    let loop = try XCTUnwrap(button.motion?.loop)
    let appearCurve = try XCTUnwrap(document.resolvedMotionCurve(appear.curve))
    let loopCurve = try XCTUnwrap(document.resolvedMotionCurve(loop.curve))

    let driver = MosaicMotionDriver.controlled()
    func frames(at driverTime: Int) throws -> (MosaicAppearFrame, MosaicLoopFrame) {
      driver.advance(to: driverTime)
      let elapsed = driver.nodeElapsedMilliseconds(at: try XCTUnwrap(driver.elapsedMilliseconds))
      return (
        try MosaicMotionResolver.appearFrame(
          appear, curve: appearCurve, elapsedMilliseconds: elapsed, reducedMotion: false),
        try MosaicMotionResolver.loopFrame(
          loop, curve: loopCurve, elapsedMilliseconds: elapsed, reducedMotion: false)
      )
    }

    driver.enterScreen(model.baseScreen?.id)
    // Let the offer screen finish entering and spend the pulse's authored cycles.
    let exhausted =
      appear.delayMilliseconds + appearCurve.durationMilliseconds
      + loopCurve.durationMilliseconds * loop.repeatCount
    let (settled, rested) = try frames(at: exhausted)
    XCTAssertTrue(settled.isStatic)
    XCTAssertTrue(rested.isStatic)

    model.navigate(to: "details")
    driver.enterScreen(model.baseScreen?.id)
    XCTAssertEqual(model.currentScreenID, "details")
    XCTAssertNotNil(model.presentedSheet)
    // The sheet is presented *over* the offer screen, which is still the base.
    XCTAssertEqual(model.baseScreen?.id, "offer")

    model.dismissPresentedSheet()
    driver.enterScreen(model.baseScreen?.id)
    XCTAssertNil(model.presentedSheet)
    XCTAssertEqual(driver.screenEntryCount, 1)
    XCTAssertEqual(driver.screenEntryElapsedMilliseconds, 0)

    // And the screen underneath is exactly where it was left: still settled, and
    // still out of pulse cycles. A rebuild would have put both back at zero.
    let (afterSheet, afterSheetPulse) = try frames(at: exhausted + 360)
    XCTAssertTrue(afterSheet.isStatic)
    XCTAssertTrue(afterSheetPulse.isStatic)
    XCTAssertEqual(afterSheetPulse.scale, 1)
  }

  // MARK: - Video backgrounds

  /// A video background stops for reduced motion on a `0.4` document and only on
  /// a `0.4` document.
  ///
  /// Protects ADR-0027 ruling 3, which is a scope ruling as much as a behaviour
  /// one: the fix ships as specified `0.4` behaviour rather than as a `0.3` defect
  /// patch, so the live `0.3` exposure stays open and visible until `0.4` is
  /// accepted. An implementation that "helpfully" applied it to `0.3` as well
  /// would close that exposure silently and diverge from Flutter and Compose.
  ///
  /// It also pins the two things a diagnostics assertion cannot say: that the
  /// stopped case renders the declared poster, and that it is a preference rather
  /// than a media failure and so records nothing.
  func testVideoBackgroundStopsUnderReducedMotionOnlyForV04Documents() throws {
    let url = try XCTUnwrap(URL(string: "https://cdn.mosaic.dev/video/ambient.mp4"))
    let reducedMotionOnly = MosaicMotionAccessibility(
      prefersReducedMotion: true, allowsVideoAutoplay: true)

    func resolve(
      _ schemaVersion: String,
      _ accessibility: MosaicMotionAccessibility,
      poster: String? = "poster"
    ) -> MosaicVideoBackgroundPresentation {
      MosaicVideoBackgroundPresentation.resolve(
        url: url,
        posterID: poster,
        schemaVersion: schemaVersion,
        accessibility: accessibility
      )
    }

    // `0.4` under reduced motion: the poster, and no player.
    XCTAssertEqual(
      resolve(mosaicMotionProtocolVersion, reducedMotionOnly),
      .still(posterID: "poster", recordsUnavailable: false)
    )
    // With no poster declared it is the declared fallback colour, still with no
    // player and still without diagnosing.
    XCTAssertEqual(
      resolve(mosaicMotionProtocolVersion, reducedMotionOnly, poster: nil),
      .still(posterID: nil, recordsUnavailable: false)
    )
    // `0.3` keeps `0.3`'s behaviour.
    XCTAssertEqual(resolve(mosaicProtocolVersion, reducedMotionOnly), .play(url: url))
    // And an unstated version is not treated as `0.4`.
    XCTAssertEqual(
      MosaicVideoBackgroundPresentation.resolve(
        url: url, posterID: "poster", schemaVersion: nil, accessibility: reducedMotionOnly),
      .play(url: url)
    )
    // Without the preference, `0.4` plays like everything else.
    XCTAssertEqual(
      resolve(mosaicMotionProtocolVersion, .unrestricted), .play(url: url))

    // Apple's own Video Autoplay switch is not a protocol rule and is honoured on
    // every version: a user who turned it off meant it.
    let autoplayOff = MosaicMotionAccessibility(
      prefersReducedMotion: false, allowsVideoAutoplay: false)
    XCTAssertEqual(
      resolve(mosaicProtocolVersion, autoplayOff),
      .still(posterID: "poster", recordsUnavailable: false)
    )

    // An unresolvable asset is a media failure rather than a preference, and is
    // the one still frame that diagnoses.
    XCTAssertEqual(
      MosaicVideoBackgroundPresentation.resolve(
        url: nil, posterID: "poster", schemaVersion: mosaicMotionProtocolVersion,
        accessibility: .unrestricted),
      .still(posterID: "poster", recordsUnavailable: true)
    )
  }

  /// The canonical `0.4` document with its second screen promoted from a sheet to
  /// a full screen, so navigating to it genuinely removes the offer screen's
  /// nodes.
  ///
  /// The declared capabilities are trimmed with it: a document that keeps
  /// `navigation.sheets` after its only sheet became a screen declares a
  /// capability nothing consumes, which the validator rejects — correctly.
  private func v04DocumentWithDetailsAsAFullScreen() throws -> MosaicPaywallDocument {
    var object = try XCTUnwrap(
      JSONSerialization.jsonObject(with: v04FixtureData()) as? [String: Any])
    var screens = try XCTUnwrap(object["screens"] as? [[String: Any]])
    let index = try XCTUnwrap(screens.firstIndex { $0["id"] as? String == "details" })
    screens[index]["presentation"] = ["type": "screen"]
    object["screens"] = screens

    var compatibility = try XCTUnwrap(object["compatibility"] as? [String: Any])
    let capabilities = try XCTUnwrap(compatibility["requiredCapabilities"] as? [[String: Any]])
    compatibility["requiredCapabilities"] = capabilities.filter {
      $0["name"] as? String != MosaicCapabilityName.sheets.rawValue
    }
    object["compatibility"] = compatibility

    return try MosaicProtocolDecoder.decode(
      JSONSerialization.data(withJSONObject: object, options: [.sortedKeys]))
  }

  // MARK: - Terminal state

  /// Every motion the canonical document authors ends at the static rendering.
  ///
  /// This is the value-level half of the terminal-state rule; the pixel-level
  /// half lives in `SwiftUISnapshotTests`. It is asserted over the real document
  /// rather than over hand-built motions so that a fixture gaining a new motion
  /// is covered without anyone remembering to extend a list.
  func testEveryAuthoredMotionInTheCanonicalDocumentEndsAtTheStaticRendering() throws {
    let document = try v04Document()
    var checked = 0

    for node in document.allNodes {
      guard let motion = node.motion else { continue }
      if let appear = motion.appear {
        let curve = try XCTUnwrap(document.resolvedMotionCurve(appear.curve))
        let end = appear.delayMilliseconds + curve.durationMilliseconds
        let frame = try MosaicMotionResolver.appearFrame(
          appear, curve: curve, elapsedMilliseconds: end, reducedMotion: false)
        XCTAssertTrue(frame.isStatic, node.id)
        checked += 1
      }
      if let loop = motion.loop {
        let curve = try XCTUnwrap(document.resolvedMotionCurve(loop.curve))
        // Flash safety is a property of the reference site, so it is checked
        // where the loop names its curve.
        XCTAssertGreaterThanOrEqual(curve.durationMilliseconds, 500, node.id)
        let frame = try MosaicMotionResolver.loopFrame(
          loop,
          curve: curve,
          elapsedMilliseconds: curve.durationMilliseconds * loop.repeatCount,
          reducedMotion: false
        )
        XCTAssertTrue(frame.isStatic, node.id)
        checked += 1
      }
      if let selection = motion.selection {
        let curve = try XCTUnwrap(document.resolvedMotionCurve(selection.curve))
        let styles = try XCTUnwrap(selectionStyles(for: node))
        let selected = styles.selected.resolving(styles.defaultStyle)
        let frame = try MosaicMotionResolver.selectionFrame(
          curve: curve,
          elapsedMilliseconds: curve.durationMilliseconds,
          reducedMotion: false,
          from: styles.defaultStyle,
          to: selected
        )
        XCTAssertEqual(frame.style, selected, node.id)
        XCTAssertEqual(frame.style, styles.resolving(selected: true), node.id)
        checked += 1
      }
    }

    XCTAssertGreaterThanOrEqual(checked, 8)
  }

  // MARK: - Helpers

  private func loopMotion(
    scaleAmplitude: Double,
    opacityAmplitude: Double,
    repeatCount: Int,
    curve: MosaicResolvedMotionCurve
  ) throws -> MosaicLoopMotion {
    let object: [String: Any] = [
      "effect": "pulse",
      "scaleAmplitude": scaleAmplitude,
      "opacityAmplitude": opacityAmplitude,
      "curve": [
        "type": "motion",
        "durationMilliseconds": curve.durationMilliseconds,
        "easing": curve.easing.rawValue,
      ],
      "repeat": ["count": repeatCount],
    ]
    return try JSONDecoder().decode(
      MosaicLoopMotion.self, from: JSONSerialization.data(withJSONObject: object))
  }

  /// The Default/Selected styles a selection motion interpolates between.
  private func selectionStyles(for node: MosaicNode) -> MosaicSelectionStyles? {
    switch node {
    case .tabs(let tabs): tabs.styles
    case .productSelector(let selector): selector.cards.first?.styles
    default: nil
    }
  }
}
