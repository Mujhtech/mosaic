import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mosaic_sdk/mosaic_sdk.dart';

void main() {
  testWidgets('canonical Protocol 0.2 paywall has a native golden baseline',
      (tester) async {
    final root = Directory.current.parent.parent;
    final document = const MosaicProtocolDecoder().decode(
      File('${root.path}/protocol/fixtures/v0.2/complete-paywall.json')
          .readAsStringSync(),
    );
    tester.view.physicalSize = const Size(600, 1800);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);

    await tester.pumpWidget(
      MaterialApp(
        theme: ThemeData(
          colorScheme: ColorScheme.fromSeed(seedColor: Colors.indigo),
        ),
        home: RepaintBoundary(
          key: const ValueKey<String>('v02-golden'),
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
              onResult: (_) {},
            ),
          ),
        ),
      ),
    );
    await tester.pump();
    await tester.pump();

    await expectLater(
      find.byKey(const ValueKey<String>('v02-golden')),
      matchesGoldenFile('goldens/complete_paywall_v02_en.png'),
    );
  });
}
