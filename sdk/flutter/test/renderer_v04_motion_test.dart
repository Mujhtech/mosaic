import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mosaic_sdk/mosaic_sdk.dart';

import 'support/canonical_fixture.dart';

/// Renderer wiring for the three Protocol 0.4 motion primitives.
///
/// The frame arithmetic is already pinned against the canonical corpus by
/// `motion_frames_conformance_test.dart`. What these tests cover is the thing
/// that file cannot: that the renderer feeds elapsed time from the injected
/// driver into that arithmetic, paints the result, and — the rule the whole
/// contract rests on — leaves the static rendering behind when the animation
/// ends.
///
/// Frames are pinned with `tester.pump(duration)`. `pumpAndSettle` is never
/// used: a looping node has frames scheduled for as long as it runs, so
/// settling would either time out or silently skip the phases under test.
void main() {
  const appearOpacityKey = ValueKey<String>('mosaic-appear-opacity');
  const appearTranslateKey = ValueKey<String>('mosaic-appear-translate');
  const loopScaleKey = ValueKey<String>('mosaic-loop-scale');
  const loopOpacityKey = ValueKey<String>('mosaic-loop-opacity');

  MosaicPaywallDocument fixtureDocument([
    String name = 'complete-paywall.json',
  ]) =>
      const MosaicProtocolDecoder().decode(
        repositoryFile('protocol/fixtures/v0.4/$name').readAsStringSync(),
      );

  Future<void> pumpPaywall(
    WidgetTester tester, {
    required bool reducedMotion,
    MosaicMotionDriver driver = const MosaicMotionDriver(),
    DateTime Function()? clock,
    MosaicPaywallDocument? document,
  }) async {
    tester.view.physicalSize = const Size(600, 3000);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: MosaicPaywall(
            document: document ?? fixtureDocument(),
            purchaseProvider: MockMosaicPurchaseProvider(
              products: const <MosaicProduct>[
                MosaicProduct(
                  id: 'mosaic_pro_monthly',
                  title: 'Monthly',
                  localizedPrice: r'$9.99',
                ),
                MosaicProduct(
                  id: 'mosaic_pro_yearly',
                  title: 'Yearly',
                  localizedPrice: r'$79.99',
                ),
                MosaicProduct(
                  id: 'mosaic_pro_lifetime',
                  title: 'Lifetime',
                  localizedPrice: r'$199.99',
                ),
              ],
            ),
            clock: clock ?? () => DateTime.utc(2030, 12, 30, 23, 59, 59),
            motionDriver: driver,
            reducedMotion: (_) => reducedMotion,
            onResult: (_) {},
          ),
        ),
      ),
    );
  }

  Finder within(String scopeKey, Key target) => find.descendant(
        of: find.byKey(ValueKey<String>(scopeKey)),
        matching: find.byKey(target),
      );

  testWidgets('appear travels to the laid-out position and leaves no residue',
      (tester) async {
    await pumpPaywall(tester, reducedMotion: false);

    // The start frame: fully transparent and displaced by the authored rise.
    expect(
        tester
            .widget<Opacity>(within('mosaic-appear-headline', appearOpacityKey))
            .opacity,
        0);
    expect(
      tester
          .widget<Transform>(
              within('mosaic-appear-headline', appearTranslateKey))
          .transform
          .getTranslation()
          .y,
      closeTo(12, 1e-3),
    );

    // A quarter of the way through a 240ms decelerate entrance.
    await tester.pump(const Duration(milliseconds: 60));
    final progress = mosaicEasedProgress(MosaicMotionEasing.decelerate, 0.25);
    expect(
      tester
          .widget<Opacity>(within('mosaic-appear-headline', appearOpacityKey))
          .opacity,
      closeTo(progress, 1e-3),
    );
    // It moves *toward* the static layout and never past it: the remaining
    // travel shrinks monotonically to zero.
    expect(
      tester
          .widget<Transform>(
              within('mosaic-appear-headline', appearTranslateKey))
          .transform
          .getTranslation()
          .y,
      closeTo(12 * (1 - progress), 1e-3),
    );

    // The terminal frame is the static rendering: full opacity and no
    // remaining travel, short-circuited rather than approached, so nothing is
    // left at 0.9999.
    await tester.pump(const Duration(milliseconds: 180));
    expect(
      tester
          .widget<Opacity>(within('mosaic-appear-headline', appearOpacityKey))
          .opacity,
      1,
    );
    expect(
      tester
          .widget<Transform>(
              within('mosaic-appear-headline', appearTranslateKey))
          .transform
          .getTranslation()
          .y,
      0,
    );
  });

  testWidgets('an authored delay holds the start frame before the effect runs',
      (tester) async {
    // Stagger is authored delay and nothing else; the subtitle waits 80ms.
    await pumpPaywall(tester, reducedMotion: false);
    await tester.pump(const Duration(milliseconds: 60));
    expect(
      tester
          .widget<Opacity>(within('mosaic-appear-subtitle', appearOpacityKey))
          .opacity,
      0,
    );

    await tester.pump(const Duration(milliseconds: 80));
    expect(
      tester
          .widget<Opacity>(within('mosaic-appear-subtitle', appearOpacityKey))
          .opacity,
      greaterThan(0),
    );
  });

  testWidgets('loop pulses a bounded run and then rests permanently',
      (tester) async {
    await pumpPaywall(tester, reducedMotion: false);

    // A cycle begins and ends at rest, so the boundary is the static rendering
    // rather than a near miss.
    expect(
      tester
          .widget<Transform>(within('mosaic-loop-purchase', loopScaleKey))
          .transform
          .getMaxScaleOnAxis(),
      closeTo(1, 1e-3),
    );

    // Half a 900ms cycle: the excursion peaks, so scale is 1 + scaleAmplitude.
    await tester.pump(const Duration(milliseconds: 450));
    expect(
      tester
          .widget<Transform>(within('mosaic-loop-purchase', loopScaleKey))
          .transform
          .getMaxScaleOnAxis(),
      closeTo(1.04, 1e-3),
    );

    // Back to rest at the cycle boundary.
    await tester.pump(const Duration(milliseconds: 450));
    expect(
      tester
          .widget<Transform>(within('mosaic-loop-purchase', loopScaleKey))
          .transform
          .getMaxScaleOnAxis(),
      closeTo(1, 1e-3),
    );

    // Three cycles of 900ms, then rest: scale exactly 1 and no dimming.
    await tester.pump(const Duration(milliseconds: 1800));
    expect(
      tester
          .widget<Transform>(within('mosaic-loop-purchase', loopScaleKey))
          .transform
          .getMaxScaleOnAxis(),
      1,
    );
    expect(
      tester
          .widget<Opacity>(within('mosaic-loop-purchase', loopOpacityKey))
          .opacity,
      1,
    );

    // Rest is permanent: a bounded run does not restart on later frames.
    await tester.pump(const Duration(milliseconds: 900));
    expect(
      tester
          .widget<Transform>(within('mosaic-loop-purchase', loopScaleKey))
          .transform
          .getMaxScaleOnAxis(),
      1,
    );
  });

  testWidgets(
      "a loop's clock starts at node entry, not when the entrance finishes",
      (tester) async {
    // Protocol 0.4 rules the time origin explicitly: a loop's elapsed clock
    // starts when the node enters the screen — the same origin as appear, and
    // the same origin whether or not the node carries one. Starting the pulse
    // when the entrance completed would make one trigger's origin a function of
    // another trigger's delay plus its resolved curve duration, which is
    // exactly the cross-trigger arithmetic three renderers get subtly
    // different.
    //
    // The canonical purchase Button carries both: a fade entrance held for
    // 240ms and then run over 240ms, and a 900ms pulse repeated three times.
    await pumpPaywall(tester, reducedMotion: false);

    double appearProgress() => tester
        .widget<Opacity>(within('mosaic-appear-purchase', appearOpacityKey))
        .opacity;
    double loopScale() => tester
        .widget<Transform>(within('mosaic-loop-purchase', loopScaleKey))
        .transform
        .getMaxScaleOnAxis();
    double loopOpacityMultiplier() => tester
        .widget<Opacity>(within('mosaic-loop-purchase', loopOpacityKey))
        .opacity;
    // Composition is asserted on what is actually painted rather than on the
    // two factors read back individually: nested Opacity multiplies, so the
    // product of every opacity in the Button's motion subtree is the node's
    // effective opacity.
    double composedOpacity() => tester
        .widgetList<Opacity>(
          find.descendant(
            of: find.byKey(const ValueKey<String>('mosaic-appear-purchase')),
            matching: find.byType(Opacity),
          ),
        )
        .fold<double>(1, (product, opacity) => product * opacity.opacity);

    // Still inside the entrance's authored 240ms delay: the entrance has not
    // started, and the pulse is already a quarter of the way through its first
    // cycle. A pulse gated on the entrance would read exactly 1 here.
    await tester.pump(const Duration(milliseconds: 225));
    expect(appearProgress(), 0);
    expect(
      loopScale(),
      closeTo(
        1 + 0.04 * mosaicEasedProgress(MosaicMotionEasing.standard, 0.5),
        1e-3,
      ),
    );
    expect(loopScale(), isNot(closeTo(1, 1e-3)));

    // One loop half-period in, with the entrance mid-flight: the pulse is at
    // peak excursion and the entrance is strictly between its endpoints.
    await tester.pump(const Duration(milliseconds: 225));
    final progress =
        mosaicEasedProgress(MosaicMotionEasing.decelerate, (450 - 240) / 240);
    expect(appearProgress(), closeTo(progress, 1e-3));
    expect(appearProgress(), greaterThan(0));
    expect(appearProgress(), lessThan(1));
    expect(loopScale(), closeTo(1.04, 1e-3));
    expect(loopOpacityMultiplier(), closeTo(0.88, 1e-3));

    // opacity = resolvedStaticOpacity x appearProgress x loopOpacityMultiplier.
    // The Button authors appearance.opacity 1, so the static factor is 1.
    expect(composedOpacity(), closeTo(1 * progress * 0.88, 1e-3));

    // scale = loopScale. The entrance contributes no scale, and this Button's
    // fade entrance contributes no translation either.
    expect(within('mosaic-appear-purchase', appearTranslateKey), findsNothing);

    // Both converge on the same static rendering regardless of the overlap.
    await tester.pump(const Duration(milliseconds: 2250));
    expect(appearProgress(), 1);
    expect(loopScale(), 1);
    expect(loopOpacityMultiplier(), 1);
    expect(composedOpacity(), 1);
  });

  testWidgets('a Sheet over a screen is not a re-entry for that screen',
      (tester) async {
    // Ruling: `appear` and `loop` replay on genuine screen re-entry, and
    // `repeat.count` is a bound per entry. A Sheet is the case that looks like
    // one and is not: it is presented *over* its screen, and this renderer
    // keeps that screen mounted underneath — which is why its scroll position,
    // selection, and Carousel page survive the round trip. Motion has to agree
    // with the rest of the screen's state, so opening and closing a Sheet must
    // neither replay the entrance beneath it nor hand its pulse a second
    // budget.
    await pumpPaywall(tester, reducedMotion: false);

    double appearProgress() => tester
        .widget<Opacity>(within('mosaic-appear-purchase', appearOpacityKey))
        .opacity;
    double loopScale() => tester
        .widget<Transform>(within('mosaic-loop-purchase', loopScaleKey))
        .transform
        .getMaxScaleOnAxis();

    // Spend the offer screen's only entry: a 240ms delayed 240ms entrance and
    // three 900ms cycles, then permanent rest.
    await tester.pump(const Duration(milliseconds: 3000));
    expect(appearProgress(), 1);
    expect(loopScale(), 1);

    // Presenting the Sheet leaves the screen beneath it exactly where it was.
    await tester.tap(find.byKey(const ValueKey<String>('mosaic-view-details')));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 600));
    expect(appearProgress(), 1);
    expect(loopScale(), 1);

    // Dismissing it does not re-enter the screen underneath. A replay here
    // would restart an entrance the customer already watched and spend a
    // second pulse budget the author never authorised.
    await tester.tap(find.byKey(const ValueKey<String>('mosaic-details-back')));
    await tester.pump();
    expect(appearProgress(), 1);
    expect(loopScale(), 1);

    // Held across a full further cycle: the pulse is spent, not merely paused
    // at a cycle boundary where rest and a restart look identical.
    await tester.pump(const Duration(milliseconds: 450));
    expect(loopScale(), 1);
    await tester.pump(const Duration(milliseconds: 2550));
    expect(appearProgress(), 1);
    expect(loopScale(), 1);
  });

  testWidgets('reopening a Sheet is a genuine entry for the Sheet itself',
      (tester) async {
    // The other half of the ruling: each user-initiated navigation entry is a
    // fresh viewing context, so the Sheet's own nodes animate on every
    // presentation rather than once ever.
    await pumpPaywall(tester, reducedMotion: false);
    await tester.pump(const Duration(milliseconds: 3000));

    double sheetTitleOpacity() => tester
        .widget<Opacity>(
            within('mosaic-appear-details-title', appearOpacityKey))
        .opacity;

    Future<void> openSheet() async {
      await tester
          .tap(find.byKey(const ValueKey<String>('mosaic-view-details')));
      await tester.pump();
      await tester.pump();
    }

    Future<void> closeSheet() async {
      await tester
          .tap(find.byKey(const ValueKey<String>('mosaic-details-back')));
      await tester.pump();
      await tester.pump();
    }

    await openSheet();
    // The Sheet's title carries a fadeRise with no delay, so it starts at zero
    // and reaches its laid-out position 240ms later.
    expect(sheetTitleOpacity(), 0);
    await tester.pump(const Duration(milliseconds: 240));
    expect(sheetTitleOpacity(), 1);

    await closeSheet();
    await tester.pump(const Duration(milliseconds: 600));

    // A second presentation is a second entry, and replays.
    await openSheet();
    expect(sheetTitleOpacity(), 0);
    await tester.pump(const Duration(milliseconds: 120));
    expect(
      sheetTitleOpacity(),
      closeTo(mosaicEasedProgress(MosaicMotionEasing.decelerate, 0.5), 1e-3),
    );
    await tester.pump(const Duration(milliseconds: 120));
    expect(sheetTitleOpacity(), 1);
  });

  testWidgets(
      'a screen round trip replays the entrance and refreshes the pulse budget',
      (tester) async {
    // The positive half of the replay ruling, which the Sheet tests can only
    // cover negatively: two Screen-presentation screens joined by navigateTo
    // and navigateBack. The start screen genuinely leaves the tree, so
    // returning to it is a fresh viewing context — its entrance plays again and
    // its pulse is handed a new budget, because `repeat.count` is a bound per
    // entry rather than per session.
    await pumpPaywall(
      tester,
      reducedMotion: false,
      document: fixtureDocument('screen-round-trip.json'),
    );

    double entranceOpacity() => tester
        .widget<Opacity>(
            within('mosaic-appear-start-content', appearOpacityKey))
        .opacity;
    double entranceTravel() => tester
        .widget<Transform>(
          within('mosaic-appear-start-content', appearTranslateKey),
        )
        .transform
        .getTranslation()
        .y;
    double pulseScale() => tester
        .widget<Transform>(within('mosaic-loop-view-details', loopScaleKey))
        .transform
        .getMaxScaleOnAxis();

    // First entry: a 240ms fadeRise from 12 logical units, and three 900ms
    // cycles of a 0.04 pulse.
    expect(entranceOpacity(), 0);
    expect(entranceTravel(), closeTo(12, 1e-3));
    await tester.pump(const Duration(milliseconds: 450));
    expect(pulseScale(), closeTo(1.04, 1e-3));

    // Spend the whole first entry, then hold: the pulse is at rest and stays
    // there, so what the round trip restarts is a bound that was fully used.
    await tester.pump(const Duration(milliseconds: 2250));
    expect(entranceOpacity(), 1);
    expect(entranceTravel(), 0);
    expect(pulseScale(), 1);
    await tester.pump(const Duration(milliseconds: 450));
    expect(pulseScale(), 1);

    // Leave for the details screen. This is a Screen, not a Sheet, so the start
    // screen genuinely leaves.
    await tester.tap(find.byKey(const ValueKey<String>('mosaic-view-details')));
    await tester.pump();
    await tester.pump();
    expect(
      find.byKey(const ValueKey<String>('mosaic-appear-start-content')),
      findsNothing,
      reason: 'the start screen must not remain mounted behind another Screen',
    );

    // Come back.
    await tester.tap(find.byKey(const ValueKey<String>('mosaic-details-back')));
    await tester.pump();
    await tester.pump();

    // Both clocks read from node entry again.
    expect(entranceOpacity(), 0);
    expect(entranceTravel(), closeTo(12, 1e-3));
    expect(pulseScale(), closeTo(1, 1e-3));

    // The entrance replays on the same curve it first played.
    await tester.pump(const Duration(milliseconds: 120));
    expect(
      entranceOpacity(),
      closeTo(mosaicEasedProgress(MosaicMotionEasing.decelerate, 0.5), 1e-3),
    );
    await tester.pump(const Duration(milliseconds: 120));
    expect(entranceOpacity(), 1);
    expect(entranceTravel(), 0);

    // And the pulse excursions again, which it could not do on a spent budget.
    await tester.pump(const Duration(milliseconds: 210));
    expect(pulseScale(), closeTo(1.04, 1e-3));

    // The second entry ends where the first did: three cycles, then rest.
    await tester.pump(const Duration(milliseconds: 2250));
    expect(entranceOpacity(), 1);
    expect(pulseScale(), 1);
  });

  testWidgets('selection interpolates the authored box style to its target',
      (tester) async {
    await pumpPaywall(tester, reducedMotion: false);
    // Let every entrance finish so the tree under test is static apart from the
    // selection transition itself.
    await tester.pump(const Duration(milliseconds: 600));

    BoxDecoration decoration(String cardId) => tester
        .widgetList<DecoratedBox>(
          find.descendant(
            of: find.byKey(ValueKey<String>('mosaic-$cardId')),
            matching: find.byType(DecoratedBox),
          ),
        )
        .map((box) => box.decoration)
        .whereType<BoxDecoration>()
        .firstWhere((decoration) => decoration.border != null);

    const card = 'plans-lifetime-plan-card';
    expect(decoration(card).border!.top.width, closeTo(1, 1e-3));

    await tester.tap(find.byKey(const ValueKey<String>('mosaic-$card')));
    await tester.pump();

    // Half of a 160ms standard curve.
    await tester.pump(const Duration(milliseconds: 80));
    final progress = mosaicEasedProgress(MosaicMotionEasing.standard, 0.5);
    expect(
      decoration(card).border!.top.width,
      closeTo(1 + 2 * progress, 1e-3),
    );
    expect(
      (decoration(card).borderRadius! as BorderRadius).topLeft.x,
      closeTo(20 + 4 * progress, 1e-3),
    );

    // The transition ends on the authored Selected style exactly.
    await tester.pump(const Duration(milliseconds: 80));
    expect(decoration(card).border!.top.width, closeTo(3, 1e-3));
    expect(
      (decoration(card).borderRadius! as BorderRadius).topLeft.x,
      closeTo(24, 1e-3),
    );
  });

  testWidgets('reduced motion drops the transform and disables the loop',
      (tester) async {
    await pumpPaywall(tester, reducedMotion: true);

    // appear is opacity only. The transform is dropped at every instant,
    // including the start frame — not shortened, and not zero-length.
    expect(
      tester
          .widget<Opacity>(within('mosaic-appear-headline', appearOpacityKey))
          .opacity,
      0,
    );
    expect(within('mosaic-appear-headline', appearTranslateKey), findsNothing);

    // loop is fully disabled: the node sits at rest, which is the static
    // rendering, from the very first frame.
    expect(within('mosaic-loop-purchase', loopScaleKey), findsNothing);
    await tester.pump(const Duration(milliseconds: 450));
    expect(within('mosaic-loop-purchase', loopScaleKey), findsNothing);
  });

  testWidgets('reduced motion applies a selection change instantly',
      (tester) async {
    await pumpPaywall(tester, reducedMotion: true);
    await tester.pump(const Duration(milliseconds: 600));

    BoxDecoration decoration(String cardId) => tester
        .widgetList<DecoratedBox>(
          find.descendant(
            of: find.byKey(ValueKey<String>('mosaic-$cardId')),
            matching: find.byType(DecoratedBox),
          ),
        )
        .map((box) => box.decoration)
        .whereType<BoxDecoration>()
        .firstWhere((decoration) => decoration.border != null);

    const card = 'plans-lifetime-plan-card';
    await tester.tap(find.byKey(const ValueKey<String>('mosaic-$card')));
    await tester.pump();

    // The frame at every elapsed time is the resolved Selected style exactly,
    // so the very next frame is already the endpoint.
    expect(decoration(card).border!.top.width, closeTo(3, 1e-3));
  });

  testWidgets(
      'reduced motion renders a video background rather than playing it',
      (tester) async {
    // Protocol 0.4 ruling: under reduced motion a video background does not
    // play. The declared poster is rendered, and no frame of the video is
    // shown, so a Mosaic paywall cannot invalidate a host's accessibility
    // declaration.
    await pumpPaywall(tester, reducedMotion: true);
    await tester.pump(const Duration(milliseconds: 600));
    await tester.tap(find.byKey(const ValueKey<String>('mosaic-view-details')));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 600));

    expect(
      find.byKey(
        const ValueKey<String>(
          'mosaic-reduced-motion-video-remote-sheet-video',
        ),
      ),
      findsOneWidget,
    );
    expect(find.byType(MosaicDecorativeVideo), findsNothing);
  });

  testWidgets('a video background plays when motion is not reduced',
      (tester) async {
    await pumpPaywall(tester, reducedMotion: false);
    await tester.pump(const Duration(milliseconds: 600));
    await tester.tap(find.byKey(const ValueKey<String>('mosaic-view-details')));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 600));

    expect(find.byType(MosaicDecorativeVideo), findsOneWidget);
    expect(
      find.byKey(
        const ValueKey<String>(
          'mosaic-reduced-motion-video-remote-sheet-video',
        ),
      ),
      findsNothing,
    );
  });

  testWidgets('a disabled driver renders every animation at its terminal frame',
      (tester) async {
    // This is what makes a static golden capturable, and it is lossless by the
    // terminal-state rule rather than by a second set of authored values.
    await pumpPaywall(
      tester,
      reducedMotion: false,
      driver: const MosaicMotionDriver.disabled(),
    );

    expect(within('mosaic-appear-headline', appearOpacityKey), findsNothing);
    expect(within('mosaic-appear-headline', appearTranslateKey), findsNothing);
    expect(within('mosaic-loop-purchase', loopScaleKey), findsNothing);
  });

  testWidgets('the countdown tick rebuilds the countdown, not the document',
      (tester) async {
    // The tick used to be a root-level setState, which rebuilt every node in
    // the document once a second to advance one line of text.
    var now = DateTime.utc(2030, 12, 30, 23, 59, 0);
    await pumpPaywall(tester, reducedMotion: false, clock: () => now);
    // Let every entrance and the pulse finish, so nothing else in the tree has
    // a reason to rebuild.
    await tester.pump(const Duration(milliseconds: 3000));

    // The canonical document hides its Countdown behind a Switch, so reveal it
    // before asserting on what its tick rebuilds.
    await tester.tap(
      find.descendant(
        of: find.byKey(const ValueKey<String>('mosaic-show-offer-details')),
        matching: find.byType(Switch),
      ),
    );
    await tester.pump();

    final headlineBefore =
        tester.widget(find.byKey(const ValueKey<String>('mosaic-headline')));
    final countdownBefore = tester
        .widget<Text>(
          find.descendant(
            of: find.byKey(const ValueKey<String>('mosaic-offer-countdown')),
            matching: find.byType(Text),
          ),
        )
        .data;

    now = now.add(const Duration(seconds: 1));
    await tester.pump(const Duration(seconds: 1));

    expect(
      tester
          .widget<Text>(
            find.descendant(
              of: find.byKey(const ValueKey<String>('mosaic-offer-countdown')),
              matching: find.byType(Text),
            ),
          )
          .data,
      isNot(countdownBefore),
      reason: 'the countdown must still advance once per second',
    );
    expect(
      identical(
        tester.widget(find.byKey(const ValueKey<String>('mosaic-headline'))),
        headlineBefore,
      ),
      isTrue,
      reason: 'a countdown tick must not rebuild unrelated nodes',
    );
  });
}
