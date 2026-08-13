import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:ui' show CheckedState, Tristate;

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mosaic_sdk/mosaic_sdk.dart';

part 'renderer_visual_tests.dart';
part 'renderer_product_tests.dart';

void main() {
  final root = Directory.current.parent.parent;

  MosaicPaywallDocument fixture(String name) =>
      const MosaicProtocolDecoder().decode(
        File('${root.path}/protocol/fixtures/v0.4/$name').readAsStringSync(),
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
  _defineRendererVisualTests(root, fixture, products);
  _defineRendererProductTests(root, fixture, products);
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
  // A design-system reference names a catalog entry, not a layout node, so it
  // lives in a different namespace and must survive id rewriting untouched.
  // `motionToken` is the fourth such catalog.
  final isTokenReference = type == 'colorToken' ||
      type == 'backgroundToken' ||
      type == 'shadowToken' ||
      type == 'motionToken';
  if (!isTokenReference && value['id'] is String) {
    final id = value['id']! as String;
    value['id'] = '$id$suffix';
  }
  for (final child in value.values.toList(growable: false)) {
    _suffixFixtureIds(child, suffix);
  }
}

/// Pumps [document] with motion pinned to its terminal frame.
///
/// The canonical document authors entrance motion, and this suite is about
/// static rendering, layout, and semantics. The terminal frame is what a
/// reduced-motion or non-animating renderer shows; frame zero is not, because a
/// fading node is still fully transparent there and therefore absent from the
/// semantics tree entirely.
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
          motionDriver: const MosaicMotionDriver.disabled(),
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

/// Scrolls [finder] into the viewport before tapping it.
///
/// The canonical fixture is taller than the 900x1600 test viewport, so a bare
/// `tap()` on a below-the-fold target derives an off-screen offset, misses
/// silently, and leaves every assertion that depends on the tap vacuous.
/// Callers keep their own settling policy after the tap.
Future<void> _tapVisible(WidgetTester tester, Finder finder) async {
  await tester.ensureVisible(finder);
  await tester.pumpAndSettle();
  await tester.tap(finder);
}

/// Scrolls [finder] into the viewport before dragging it, for the same reason
/// as [_tapVisible].
Future<void> _dragVisible(
  WidgetTester tester,
  Finder finder,
  Offset offset,
) async {
  await tester.ensureVisible(finder);
  await tester.pumpAndSettle();
  await tester.drag(finder, offset);
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
