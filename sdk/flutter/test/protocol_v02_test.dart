import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:mosaic_sdk/mosaic_sdk.dart';

void main() {
  final root = Directory.current.parent.parent;

  String fixture(String name) => File(
        '${root.path}/protocol/fixtures/v0.2/$name',
      ).readAsStringSync();

  test('strictly decodes every canonical valid Protocol 0.2 fixture', () {
    for (final name in <String>[
      'complete-paywall.json',
      'migrated-v0.1.json',
      'edge-cases.json',
      'expired-countdown.json',
      'hidden-purchase-target.json',
      'navigation-only.json',
    ]) {
      final document = const MosaicProtocolDecoder().decode(fixture(name));
      expect(document.schemaVersion, mosaicProtocolV02Version, reason: name);
      expect(document.initialScreenId, isNotNull, reason: name);
      expect(document.screens, isNotEmpty, reason: name);
      expect(
        document.screens.every(
          (screen) => screen.layout.content is MosaicStackComponent,
        ),
        isTrue,
        reason: name,
      );
    }
  });

  test('rejects every canonical invalid RC3 fixture atomically', () {
    for (final name in <String>[
      'invalid/noncanonical-color.json',
      'invalid/insecure-external-url.json',
      'invalid/interactive-button-child.json',
      'invalid/navigation-cycle.json',
      'invalid/product-card-outside-selector.json',
      'invalid/interactive-product-card-child.json',
      'invalid/duplicate-product-reference.json',
      'invalid/incomplete-product-card-default.json',
      'invalid/unsafe-product-template.json',
    ]) {
      expect(
        () => const MosaicProtocolDecoder().decode(fixture(name)),
        throwsA(isA<MosaicProtocolException>()),
        reason: name,
      );
    }
  });

  test('migration fixture preserves the 0.1 document identity and node IDs',
      () {
    final v01 = const MosaicProtocolDecoder().decode(
      File('${root.path}/protocol/fixtures/v0.1/complete-paywall.json')
          .readAsStringSync(),
    );
    final migrated = const MosaicProtocolDecoder().decode(
      fixture('migrated-v0.1.json'),
    );

    expect(migrated.id, v01.id);
    expect(migrated.revision, v01.revision);
    expect(
      migrated.nodes.map((node) => node.id).toSet(),
      containsAll(v01.nodes.map((node) => node.id)),
    );
    expect(v01.layout.content, isA<MosaicVerticalStack>());
    expect(migrated.layout.content, isA<MosaicStackComponent>());
    expect(migrated.screens, hasLength(1));
    expect(
      migrated.nodes.whereType<MosaicButtonComponent>().map((node) => node.id),
      containsAll(<String>['purchase', 'restore', 'close']),
    );
    expect(
      migrated.nodes
          .whereType<MosaicTextComponent>()
          .singleWhere((node) => node.id == 'legal')
          .typography
          ?.maxLines,
      isNull,
    );
  });

  test('0.2 reader rejects unknown fields and unknown components atomically',
      () {
    final source =
        jsonDecode(fixture('complete-paywall.json'))! as Map<String, Object?>;
    final withUnknownField = Map<String, Object?>.from(source)
      ..['flutterOnly'] = true;
    expect(
      () => const MosaicProtocolDecoder().decode(jsonEncode(withUnknownField)),
      throwsA(isA<MosaicProtocolException>()),
    );

    final withUnknownComponent =
        jsonDecode(fixture('complete-paywall.json'))! as Map<String, Object?>;
    final screens = withUnknownComponent['screens']! as List<Object?>;
    final screen = screens.first! as Map<String, Object?>;
    final layout = screen['layout']! as Map<String, Object?>;
    final rootStack = layout['content']! as Map<String, Object?>;
    final children = rootStack['children']! as List<Object?>;
    final first = children.first! as Map<String, Object?>;
    children[0] = <String, Object?>{...first, 'type': 'flutterWidget'};
    expect(
      () => const MosaicProtocolDecoder()
          .decode(jsonEncode(withUnknownComponent)),
      throwsA(isA<MosaicProtocolException>()),
    );
  });

  test('rejects legacy RC1 components and interactive Button descendants', () {
    final legacy =
        jsonDecode(fixture('complete-paywall.json'))! as Map<String, Object?>;
    final close = _node(legacy, 'close');
    close['type'] = 'closeButton';
    expect(
      () => const MosaicProtocolDecoder().decode(jsonEncode(legacy)),
      throwsA(isA<MosaicProtocolException>()),
    );

    final interactive =
        jsonDecode(fixture('complete-paywall.json'))! as Map<String, Object?>;
    final detailsButton = _node(interactive, 'view-details');
    final selector = Map<String, Object?>.from(_node(interactive, 'plans'))
      ..['id'] = 'nested-plans';
    (detailsButton['children']! as List<Object?>).add(selector);
    expect(
      () => const MosaicProtocolDecoder().decode(jsonEncode(interactive)),
      throwsA(isA<MosaicProtocolException>()),
    );
  });

  test('rejects unsafe external URLs and cyclic forward navigation', () {
    for (final url in <String>[
      'https://user:secret@example.com/privacy',
      'https://example.com/privacy policy',
      'https://例え.テスト/privacy',
      r'https://example.com\@evil.example/privacy',
      'https://example.com:70000/privacy',
    ]) {
      final unsafe =
          jsonDecode(fixture('complete-paywall.json'))! as Map<String, Object?>;
      (_node(unsafe, 'privacy-policy')['action']!
          as Map<String, Object?>)['url'] = url;
      expect(
        () => const MosaicProtocolDecoder().decode(jsonEncode(unsafe)),
        throwsA(isA<MosaicProtocolException>()),
        reason: url,
      );
    }

    final punycode =
        jsonDecode(fixture('complete-paywall.json'))! as Map<String, Object?>;
    (_node(punycode, 'privacy-policy')['action']!
            as Map<String, Object?>)['url'] =
        'https://xn--r8jz45g.xn--zckzah/privacy';
    expect(
      const MosaicProtocolDecoder().decode(jsonEncode(punycode)).schemaVersion,
      mosaicProtocolV02Version,
    );

    final cyclic =
        jsonDecode(fixture('complete-paywall.json'))! as Map<String, Object?>;
    _node(cyclic, 'details-back')['action'] = <String, Object?>{
      'type': 'navigateTo',
      'screenId': 'offer',
    };
    expect(
      () => const MosaicProtocolDecoder().decode(jsonEncode(cyclic)),
      throwsA(isA<MosaicProtocolException>()),
    );
  });

  test('requires accessibility labels on every multi-screen document', () {
    final source =
        jsonDecode(fixture('complete-paywall.json'))! as Map<String, Object?>;
    final screens = source['screens']! as List<Object?>;
    (screens.last! as Map<String, Object?>).remove('accessibilityLabel');

    expect(
      () => const MosaicProtocolDecoder().decode(jsonEncode(source)),
      throwsA(isA<MosaicProtocolException>()),
    );
  });

  test('bundled fallback safely replaces a rejected 0.2 candidate', () async {
    final result = await const MosaicPaywallLoader().load(
      candidateDocument: fixture('invalid/noncanonical-color.json'),
      bundledFallbackLoader: () async => fixture('complete-paywall.json'),
    );

    expect(result, isA<MosaicPaywallLoaded>());
    expect((result as MosaicPaywallLoaded).document.schemaVersion, '0.2');
    expect(result.source, MosaicPaywallDocumentSource.bundledFallback);
  });

  test('capability report is exact for strict dual-version support', () {
    final document = const MosaicProtocolDecoder().decode(
      fixture('complete-paywall.json'),
    );
    expect(
      mosaicFlutterCapabilityReport.supportedSchemaVersions,
      <String>{'0.1', '0.2'},
    );
    expect(
      mosaicProtocolV02Capabilities,
      document.compatibility.requiredCapabilities
          .map((capability) => capability.name)
          .toSet(),
    );
    expect(
      document.compatibility.requiredCapabilities
          .map((capability) => capability.version),
      everyElement('0.2'),
    );
  });

  test('decodes and safely resolves the complete RC4 visual contract', () {
    final document = const MosaicProtocolDecoder().decode(
      fixture('complete-paywall.json'),
    );

    expect(document.designSystem?.colors, hasLength(2));
    expect(document.designSystem?.backgrounds, hasLength(5));
    expect(document.designSystem?.shadows, hasLength(2));
    expect(
      document.resolveColor(const MosaicColorValue.token('brand-accent')).value,
      '#007F73FF',
    );
    expect(
      document.resolveBackground(
        const MosaicBackgroundTokenReference('offer-gradient'),
      ),
      isA<MosaicLinearGradientBackground>(),
    );
    expect(
      document
          .resolveShadow(const MosaicShadowTokenReference('elevated'))
          .blurRadius,
      24,
    );
    expect(
        document.initialScreen?.presentation, MosaicScreenPresentation.screen);
    expect(document.screen('details')?.presentation,
        MosaicScreenPresentation.sheet);
    expect(
      document.assets.where((asset) => asset.source is MosaicRemoteAssetSource),
      hasLength(2),
    );
    expect(document.assets.whereType<MosaicVideoAsset>(), hasLength(2));

    final hero = document.nodes
        .whereType<MosaicImageComponent>()
        .singleWhere((node) => node.id == 'hero');
    expect(hero.sizing?.width.mode, MosaicSizingMode.fill);
    expect(hero.sizing?.height.mode, MosaicSizingMode.fixed);
    expect(hero.sizing?.height.value, 180);
  });

  test('decodes authored Product Card and Product Badge structure', () {
    final document = const MosaicProtocolDecoder().decode(
      fixture('complete-paywall.json'),
    );
    final selector =
        document.nodes.whereType<MosaicProductSelectorComponent>().single;

    expect(selector.initialProductCardId, 'plans-yearly-plan-card');
    expect(selector.cards, hasLength(3));
    expect(
      selector.cards.map((card) => card.productReferenceId),
      <String>['monthly-plan', 'yearly-plan', 'lifetime-plan'],
    );
    expect(
      document.nodes.whereType<MosaicProductCardComponent>(),
      hasLength(3),
    );
    expect(
      document.nodes.whereType<MosaicProductBadgeComponent>(),
      hasLength(2),
    );
    expect(
      selector.cards[1].badge!.placement,
      isA<MosaicNestedProductBadgePlacement>(),
    );
    final overlay = selector.cards[2].badge!.placement
        as MosaicOverlayProductBadgePlacement;
    expect(overlay.anchor, MosaicProductBadgeAnchor.topEnd);
    expect(overlay.inset, 8);
    expect(document.products.every((product) => product.badge == null), isTrue);
  });

  test('accepts whitespace-tolerant safe Product Card templates', () {
    final source =
        jsonDecode(fixture('complete-paywall.json'))! as Map<String, Object?>;
    final name = _node(source, 'plans-monthly-plan-card-name');
    (name['value']! as Map<String, Object?>)['default'] =
        '{{   product.name   }}';
    final localization = source['localization']! as Map<String, Object?>;
    final locales = localization['locales']! as Map<String, Object?>;
    final english = locales['en']! as Map<String, Object?>;
    final strings = english['strings']! as Map<String, Object?>;
    strings['mosaic.migration.product_card_1.name'] = '{{   product.name   }}';

    final document = const MosaicProtocolDecoder().decode(jsonEncode(source));
    expect(
      document.nodes
          .whereType<MosaicTextComponent>()
          .singleWhere((node) => node.id == 'plans-monthly-plan-card-name')
          .value
          .defaultValue,
      '{{   product.name   }}',
    );
  });
}

Map<String, Object?> _node(Map<String, Object?> document, String id) {
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
    for (final entry in value.values) {
      visit(entry);
    }
  }

  visit(document['screens']);
  return result ?? (throw StateError('Missing fixture node $id'));
}
