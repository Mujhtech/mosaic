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
  const appearOpacity = ValueKey<String>('mosaic-appear-opacity');
  const appearTranslate = ValueKey<String>('mosaic-appear-translate');
  const loopScale = ValueKey<String>('mosaic-loop-scale');
  const loopOpacity = ValueKey<String>('mosaic-loop-opacity');

  MosaicPaywallDocument document() => const MosaicProtocolDecoder().decode(
        repositoryFile('protocol/fixtures/v0.4/complete-paywall.json')
            .readAsStringSync(),
      );

  Future<void> pumpPaywall(
    WidgetTester tester, {
    required bool reducedMotion,
    MosaicMotionDriver driver = const MosaicMotionDriver(),
    DateTime Function()? clock,
  }) async {
    tester.view.physicalSize = const Size(600, 3000);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: MosaicPaywall(
            document: document(),
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
            .widget<Opacity>(within('mosaic-appear-headline', appearOpacity))
            .opacity,
        0);
    expect(
      tester
          .widget<Transform>(within('mosaic-appear-headline', appearTranslate))
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
          .widget<Opacity>(within('mosaic-appear-headline', appearOpacity))
          .opacity,
      closeTo(progress, 1e-3),
    );
    // It moves *toward* the static layout and never past it: the remaining
    // travel shrinks monotonically to zero.
    expect(
      tester
          .widget<Transform>(within('mosaic-appear-headline', appearTranslate))
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
          .widget<Opacity>(within('mosaic-appear-headline', appearOpacity))
          .opacity,
      1,
    );
    expect(
      tester
          .widget<Transform>(within('mosaic-appear-headline', appearTranslate))
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
          .widget<Opacity>(within('mosaic-appear-subtitle', appearOpacity))
          .opacity,
      0,
    );

    await tester.pump(const Duration(milliseconds: 80));
    expect(
      tester
          .widget<Opacity>(within('mosaic-appear-subtitle', appearOpacity))
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
          .widget<Transform>(within('mosaic-loop-purchase', loopScale))
          .transform
          .getMaxScaleOnAxis(),
      closeTo(1, 1e-3),
    );

    // Half a 900ms cycle: the excursion peaks, so scale is 1 + scaleAmplitude.
    await tester.pump(const Duration(milliseconds: 450));
    expect(
      tester
          .widget<Transform>(within('mosaic-loop-purchase', loopScale))
          .transform
          .getMaxScaleOnAxis(),
      closeTo(1.04, 1e-3),
    );

    // Back to rest at the cycle boundary.
    await tester.pump(const Duration(milliseconds: 450));
    expect(
      tester
          .widget<Transform>(within('mosaic-loop-purchase', loopScale))
          .transform
          .getMaxScaleOnAxis(),
      closeTo(1, 1e-3),
    );

    // Three cycles of 900ms, then rest: scale exactly 1 and no dimming.
    await tester.pump(const Duration(milliseconds: 1800));
    expect(
      tester
          .widget<Transform>(within('mosaic-loop-purchase', loopScale))
          .transform
          .getMaxScaleOnAxis(),
      1,
    );
    expect(
      tester
          .widget<Opacity>(within('mosaic-loop-purchase', loopOpacity))
          .opacity,
      1,
    );

    // Rest is permanent: a bounded run does not restart on later frames.
    await tester.pump(const Duration(milliseconds: 900));
    expect(
      tester
          .widget<Transform>(within('mosaic-loop-purchase', loopScale))
          .transform
          .getMaxScaleOnAxis(),
      1,
    );
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
          .widget<Opacity>(within('mosaic-appear-headline', appearOpacity))
          .opacity,
      0,
    );
    expect(within('mosaic-appear-headline', appearTranslate), findsNothing);

    // loop is fully disabled: the node sits at rest, which is the static
    // rendering, from the very first frame.
    expect(within('mosaic-loop-purchase', loopScale), findsNothing);
    await tester.pump(const Duration(milliseconds: 450));
    expect(within('mosaic-loop-purchase', loopScale), findsNothing);
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

    expect(within('mosaic-appear-headline', appearOpacity), findsNothing);
    expect(within('mosaic-appear-headline', appearTranslate), findsNothing);
    expect(within('mosaic-loop-purchase', loopScale), findsNothing);
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
