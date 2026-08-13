import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mosaic_sdk/mosaic_sdk.dart';

import 'support/canonical_fixture.dart';

/// Feature List marker rendering: the authored size and the documented
/// default, drawn through the marker union Timeline shares.
void main() {
  String fixture(String name) =>
      repositoryFile('protocol/fixtures/v0.4/$name').readAsStringSync();

  Map<String, Object?> featureList(Map<String, Object?> document) {
    Map<String, Object?>? visit(Object? node) {
      if (node is Map<String, Object?>) {
        if (node['type'] == 'featureList') return node;
        for (final value in node.values) {
          final found = visit(value);
          if (found != null) return found;
        }
      } else if (node is List<Object?>) {
        for (final value in node) {
          final found = visit(value);
          if (found != null) return found;
        }
      }
      return null;
    }

    return visit(document['screens'])!;
  }

  Future<double> pumpMarkerSize(WidgetTester tester, String source) async {
    tester.view.physicalSize = const Size(600, 3000);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: MosaicPaywall(
            document: const MosaicProtocolDecoder().decode(source),
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
            clock: () => DateTime.utc(2030, 12, 30, 23, 59, 59),
            // Nothing here depends on elapsed time, and a disabled driver keeps
            // the Feature List's own entrance out of the measurement.
            motionDriver: const MosaicMotionDriver.disabled(),
            onResult: (_) {},
          ),
        ),
      ),
    );
    return tester
        .widget<Icon>(
          find.descendant(
            of: find.byKey(
              const ValueKey<String>('mosaic-features-unlimited-projects'),
            ),
            matching: find.byType(Icon),
          ),
        )
        .size!;
  }

  testWidgets(
      'a Feature List marker draws at its authored size, then at the '
      'documented default', (tester) async {
    // `markerSize` is authorable on a Feature List from 0.4, mirroring
    // Timeline's field of the same name. Flutter drew a hardcoded 20 before
    // the field existed, which is exactly the per-platform divergence the
    // schema's documented default — the list's own `typography.fontSize` —
    // removes. Neither branch may be a constant this renderer picked.
    // The two branches are pinned against two canonical fixtures rather than
    // one mutated document: `complete-paywall` authors 18 against a fontSize of
    // 16 so the branches stay distinguishable, and `hidden-purchase-target`
    // leaves it absent.
    expect(await pumpMarkerSize(tester, fixture('complete-paywall.json')), 18);
    expect(
      await pumpMarkerSize(tester, fixture('hidden-purchase-target.json')),
      16,
    );

    // A positive logical size, bounded exactly as Timeline's is. A zero-extent
    // marker is a glyph nobody can see beside a claim the paywall is making.
    final zero =
        jsonDecode(fixture('complete-paywall.json'))! as Map<String, Object?>;
    featureList(zero)['markerSize'] = 0;
    expect(
      () => const MosaicProtocolDecoder().decode(jsonEncode(zero)),
      throwsA(isA<MosaicProtocolException>()),
    );
  });
}
