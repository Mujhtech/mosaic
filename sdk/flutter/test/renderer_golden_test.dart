import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mosaic_sdk/mosaic_sdk.dart';

import 'support/canonical_fixture.dart';

void main() {
  testWidgets('canonical RC1 paywall has a deterministic native baseline',
      (tester) async {
    tester.view.devicePixelRatio = 1;
    tester.view.physicalSize = const Size(430, 1200);
    addTearDown(tester.view.resetDevicePixelRatio);
    addTearDown(tester.view.resetPhysicalSize);

    await tester.pumpWidget(
      MaterialApp(
        debugShowCheckedModeBanner: false,
        theme: ThemeData(
          useMaterial3: true,
          colorScheme: ColorScheme.fromSeed(
            seedColor: const Color(0xff6750a4),
          ),
        ),
        home: RepaintBoundary(
          key: const ValueKey<String>('mosaic-golden-boundary'),
          child: Scaffold(
            backgroundColor: const Color(0xfffdf8ff),
            body: MosaicPaywall(
              document: decodeCanonicalFixture(),
              purchaseProvider: MockMosaicPurchaseProvider(
                products: const <MosaicProduct>[
                  MosaicProduct(
                    id: 'mosaic_pro_monthly',
                    title: 'Mosaic Pro Monthly',
                    localizedPrice: r'$5.99',
                    localizedPeriod: 'month',
                  ),
                  MosaicProduct(
                    id: 'mosaic_pro_yearly',
                    title: 'Mosaic Pro Yearly',
                    localizedPrice: r'$49.99',
                    localizedPeriod: 'year',
                  ),
                ],
              ),
              onResult: (_) {},
            ),
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();

    await expectLater(
      find.byKey(const ValueKey<String>('mosaic-golden-boundary')),
      matchesGoldenFile('goldens/complete_paywall_en.png'),
    );
  });
}
