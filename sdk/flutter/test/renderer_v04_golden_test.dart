import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mosaic_sdk/mosaic_sdk.dart';

import 'support/canonical_fixture.dart';

/// The terminal-state rule, asserted in pixels.
///
/// Both tests below compare against the *same* golden file. One captures the
/// document with the motion driver disabled — a renderer that cannot animate —
/// and the other captures it after every authored animation has run its course.
/// That they are the same image is what makes `renderWithoutMotion` a lossless
/// fallback rather than a second set of authored values to keep in sync, and it
/// is the reason a motion bug can never leave a price or a purchase control
/// looking different from what a motion-less reader draws.
void main() {
  const goldenFile = 'goldens/complete_paywall_v04_en.png';

  Future<void> pumpCanonical(
    WidgetTester tester, {
    required MosaicMotionDriver driver,
    required Key repaintKey,
  }) async {
    final document = const MosaicProtocolDecoder().decode(
      repositoryFile('protocol/fixtures/v0.4/complete-paywall.json')
          .readAsStringSync(),
    );
    // Tall enough to capture every component the canonical fixture authors.
    tester.view.physicalSize = const Size(600, 3000);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);

    await tester.pumpWidget(
      MaterialApp(
        theme: ThemeData(
          colorScheme: ColorScheme.fromSeed(seedColor: Colors.indigo),
        ),
        home: RepaintBoundary(
          key: repaintKey,
          child: Scaffold(
            body: MosaicPaywall(
              document: document,
              purchaseProvider: MockMosaicPurchaseProvider(
                products: const <MosaicProduct>[
                  MosaicProduct(
                    id: 'mosaic_pro_monthly',
                    title: 'Monthly',
                    localizedPrice: r'$9.99',
                    localizedPeriod: 'month',
                  ),
                  MosaicProduct(
                    id: 'mosaic_pro_yearly',
                    title: 'Yearly',
                    localizedPrice: r'$79.99',
                    localizedPeriod: 'year',
                  ),
                  MosaicProduct(
                    id: 'mosaic_pro_lifetime',
                    title: 'Lifetime Access',
                    localizedPrice: r'$199.99',
                  ),
                ],
              ),
              clock: () => DateTime.utc(2030, 12, 30, 23, 59, 59),
              motionDriver: driver,
              reducedMotion: (_) => false,
              onResult: (_) {},
            ),
          ),
        ),
      ),
    );
  }

  testWidgets('the canonical Protocol 0.4 paywall has a static baseline',
      tags: 'golden', (tester) async {
    const key = ValueKey<String>('v04-static-golden');
    await pumpCanonical(
      tester,
      driver: const MosaicMotionDriver.disabled(),
      repaintKey: key,
    );
    await tester.pump();
    await tester.pump();

    await expectLater(find.byKey(key), matchesGoldenFile(goldenFile));
  });

  testWidgets('every animation ends on the static baseline', tags: 'golden',
      (tester) async {
    const key = ValueKey<String>('v04-terminal-golden');
    await pumpCanonical(
      tester,
      driver: const MosaicMotionDriver(),
      repaintKey: key,
    );
    // Past the longest authored run: a 900ms pulse repeated three times. Frames
    // are pinned rather than settled, because a looping node schedules frames
    // for as long as it runs.
    await tester.pump(const Duration(milliseconds: 3000));
    await tester.pump();

    await expectLater(find.byKey(key), matchesGoldenFile(goldenFile));
  });
}
