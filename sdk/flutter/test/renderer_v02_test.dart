import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:ui' show CheckedState, Tristate;

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mosaic_sdk/mosaic_sdk.dart';

part 'renderer_v02_visual_tests.dart';
part 'renderer_v02_product_tests.dart';

void main() {
  final root = Directory.current.parent.parent;

  MosaicPaywallDocument fixture(String name) =>
      const MosaicProtocolDecoder().decode(
        File('${root.path}/protocol/fixtures/v0.2/$name').readAsStringSync(),
      );

  const products = <MosaicProduct>[
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
  ];
  _defineRendererV02VisualTests(root, fixture, products);
  _defineRendererV02ProductTests(root, fixture, products);
}

Map<String, Object?> _jsonNode(Map<String, Object?> document, String id) {
  Map<String, Object?>? result;
  void visit(Object? value) {
    if (result != null) return;
    if (value is List<Object?>) {
      for (final item in value) {
        visit(item);
      }
      return;
    }
    if (value is! Map<String, Object?>) return;
    if (value['id'] == id && value.containsKey('type')) {
      result = value;
      return;
    }
    for (final item in value.values) {
      visit(item);
    }
  }

  visit(document['screens']);
  return result ?? (throw StateError('Missing fixture node $id'));
}

Map<String, Object?> _jsonNodeCopy(
  Map<String, Object?> document,
  String id,
) =>
    jsonDecode(jsonEncode(_jsonNode(document, id)))! as Map<String, Object?>;

void _suffixFixtureIds(Object? value, String suffix) {
  if (value is List<Object?>) {
    for (final child in value) {
      _suffixFixtureIds(child, suffix);
    }
    return;
  }
  if (value is! Map<String, Object?>) return;
  final type = value['type'];
  final isTokenReference = type == 'colorToken' ||
      type == 'backgroundToken' ||
      type == 'shadowToken';
  if (!isTokenReference && value['id'] is String) {
    final id = value['id']! as String;
    value['id'] = '$id$suffix';
  }
  for (final child in value.values.toList(growable: false)) {
    _suffixFixtureIds(child, suffix);
  }
}

Future<void> _pump(
  WidgetTester tester,
  MosaicPaywallDocument document, {
  List<MosaicProduct> products = const <MosaicProduct>[],
  MosaicClock? clock,
  MosaicDiagnosticCallback? onDiagnostic,
  MosaicInteractionCallback? onInteraction,
  MosaicExternalUrlOpener? externalUrlOpener,
  MosaicPurchaseProvider? purchaseProvider,
  MosaicPresentationResultCallback? onResult,
  String? requestedLocale,
  ThemeData? theme,
}) async {
  tester.view.physicalSize = const Size(900, 1600);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.resetPhysicalSize);
  addTearDown(tester.view.resetDevicePixelRatio);
  await tester.pumpWidget(
    MaterialApp(
      theme: theme,
      home: Scaffold(
        body: MosaicPaywall(
          document: document,
          purchaseProvider: purchaseProvider ??
              MockMosaicPurchaseProvider(products: products),
          clock: clock ?? DateTime.now,
          onResult: onResult ?? (_) {},
          requestedLocale: requestedLocale,
          onInteraction: onInteraction,
          onDiagnostic: onDiagnostic,
          externalUrlOpener: externalUrlOpener ?? (_) async => true,
        ),
      ),
    ),
  );
  await tester.pump();
  await tester.pump();
}

final class _PendingPurchaseProvider implements MosaicPurchaseProvider {
  _PendingPurchaseProvider(this.products);

  final List<MosaicProduct> products;
  final Completer<MosaicPurchaseResult> _purchase = Completer();
  int purchaseCalls = 0;

  void completePurchase() {
    _purchase.complete(
      const MosaicPurchased(
        productId: 'mosaic_pro_yearly',
        transactionId: 'rc2-test',
      ),
    );
  }

  @override
  Future<MosaicActiveEntitlementsResult> activeEntitlements() async =>
      MosaicActiveEntitlements(const <MosaicEntitlement>[]);

  @override
  Future<MosaicProductLoadResult> loadProducts(
    Iterable<String> productIds,
  ) async =>
      MosaicProductsLoaded(products);

  @override
  Future<MosaicPurchaseResult> purchase(String productId) {
    purchaseCalls += 1;
    return _purchase.future;
  }

  @override
  Future<MosaicRestoreResult> restore() async => const MosaicNothingToRestore();
}
