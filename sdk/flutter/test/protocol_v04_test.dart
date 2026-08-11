import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:mosaic_sdk/mosaic_sdk.dart';

import 'support/canonical_fixture.dart';

/// Protocol 0.4 decoding.
///
/// 0.4 is a pure superset of 0.3 apart from two removals 0.3 named for it, so
/// most of the surface is already covered by the 0.3 suite. What is tested here
/// is exactly the delta: version dispatch, the motion vocabulary, the
/// consolidated marker union, and the two cleanups.
void main() {
  String fixture(String name) =>
      repositoryFile('protocol/fixtures/v0.4/$name').readAsStringSync();

  MosaicPaywallDocument canonical() =>
      const MosaicProtocolDecoder().decode(fixture('complete-paywall.json'));

  T node<T extends MosaicNode>(MosaicPaywallDocument document, String id) =>
      document.nodes.whereType<T>().firstWhere((node) => node.id == id);

  test('accepts both schema versions and dispatches on the declared one', () {
    // Versions are exact identifiers, not ranges. A 0.3 document is still read
    // as 0.3 and gains no motion vocabulary by this SDK also implementing 0.4.
    final v03 = const MosaicProtocolDecoder().decode(canonicalFixtureSource());
    expect(v03.schemaVersion, '0.3');
    expect(v03.designSystem!.motions, isEmpty);
    expect(v03.nodes.every((node) => node.motion == null), isTrue);

    expect(canonical().schemaVersion, '0.4');

    final unknown =
        jsonDecode(fixture('complete-paywall.json'))! as Map<String, Object?>;
    unknown['schemaVersion'] = '0.5';
    expect(
      () => const MosaicProtocolDecoder().decode(jsonEncode(unknown)),
      throwsA(
        isA<MosaicProtocolException>().having(
          (error) => error.rejection,
          'rejection',
          MosaicProtocolRejection.unsupportedSchemaVersion,
        ),
      ),
    );
  });

  test('strictly decodes every canonical valid Protocol 0.4 fixture', () {
    final directory = repositoryDirectory('protocol/fixtures/v0.4');
    var decoded = 0;
    for (final file in canonicalFixtureFiles(directory)) {
      final name = file.uri.pathSegments.last;
      // The frame corpus is conformance vectors, not a paywall document.
      if (name == 'motion-frames.json') continue;
      // The announcement corpus names components by id and carries no document.
      if (name == 'accessibility-announcement.json') continue;
      final document =
          const MosaicProtocolDecoder().decode(file.readAsStringSync());
      expect(document.schemaVersion, '0.4', reason: name);
      decoded += 1;
    }
    expect(decoded, greaterThan(1));
  });

  test('rejects every canonical invalid Protocol 0.4 fixture atomically', () {
    final directory = repositoryDirectory('protocol/fixtures/v0.4/invalid');
    final rejected = <String>{};
    for (final file in canonicalFixtureFiles(directory)) {
      final name = file.uri.pathSegments.last;
      expect(
        () => const MosaicProtocolDecoder().decode(file.readAsStringSync()),
        throwsA(isA<MosaicProtocolException>()),
        reason: name,
      );
      rejected.add(name);
    }
    // The five motion rejections are the point of this sweep: a document that
    // authors unsafe or incoherent motion must not reach a renderer at all.
    expect(
      rejected,
      containsAll(<String>{
        'nested-appear-motion.json',
        'two-loops-on-one-screen.json',
        'loop-motion-below-flash-floor.json',
        'loop-motion-outside-button.json',
        'rise-on-fade-appear.json',
        'unknown-motion-token.json',
        'unused-motion-token.json',
      }),
    );
  });

  test('decodes the motion catalog and resolves token chains', () {
    final document = canonical();
    final motions = document.designSystem!.motions;
    expect(motions.map((token) => token.id), contains('motion-entrance'));

    // A token may point at another token; every reference must resolve.
    final alias = motions.firstWhere((t) => t.id == 'motion-entrance-alias');
    final resolved = document.resolveMotion(alias.value);
    expect(resolved.durationMilliseconds, 240);
    expect(resolved.easing, MosaicMotionEasing.decelerate);

    expect(
      () => document.resolveMotion(
        const MosaicMotionTokenReference('motion-absent'),
      ),
      throwsA(isA<MosaicProtocolException>()),
    );
  });

  test('decodes the three motion triggers where the contract allows them', () {
    final document = canonical();

    final headline = node<MosaicTextComponent>(document, 'headline');
    final appear = headline.motion!.appear!;
    expect(appear.effect, MosaicAppearEffect.fadeRise);
    expect(appear.riseLogicalSize, 12);
    expect(appear.delayMilliseconds, 0);

    // Stagger is authored as different sibling delays; there is no sugar.
    final subtitle = node<MosaicTextComponent>(document, 'subtitle');
    expect(subtitle.motion!.appear!.delayMilliseconds, 80);

    final selector = node<MosaicProductSelectorComponent>(document, 'plans');
    expect(selector.motion!.selection, isNotNull);
    expect(selector.motion!.appear, isNull);

    final purchase = node<MosaicButtonComponent>(document, 'purchase');
    final loop = purchase.motion!.loop!;
    expect(loop.effect, MosaicLoopEffect.pulse);
    expect(loop.scaleAmplitude, 0.04);
    expect(loop.opacityAmplitude, 0.12);
    expect(loop.repeatCount, 3);
    expect(purchase.motion!.appear!.delayMilliseconds, 240);

    // Resolving a node's motion inlines every curve, which is what the pure
    // frame resolvers require.
    final inlined = document.resolveNodeMotion(purchase.motion!);
    expect(inlined.loop!.curve, isA<MosaicInlineMotion>());
    expect(
      (inlined.loop!.curve as MosaicInlineMotion).durationMilliseconds,
      900,
    );
  });

  test('a 0.3 document cannot carry a motion block or a motions catalog', () {
    // 0.4 is additive, but additions do not travel backwards: 0.3 has no motion
    // vocabulary, so authoring one there is an unknown property rather than a
    // silently ignored hint.
    final withMotion =
        jsonDecode(canonicalFixtureSource())! as Map<String, Object?>;
    final headline = _find(withMotion, 'headline');
    headline['motion'] = <String, Object?>{
      'appear': <String, Object?>{
        'effect': 'fade',
        'curve': <String, Object?>{
          'type': 'motion',
          'durationMilliseconds': 200,
          'easing': 'linear',
        },
        'delayMilliseconds': 0,
      },
    };
    expect(
      () => const MosaicProtocolDecoder().decode(jsonEncode(withMotion)),
      throwsA(isA<MosaicProtocolException>()),
    );

    final withCatalog =
        jsonDecode(canonicalFixtureSource())! as Map<String, Object?>;
    (withCatalog['designSystem']! as Map<String, Object?>)['motions'] =
        <Object?>[];
    expect(
      () => const MosaicProtocolDecoder().decode(jsonEncode(withCatalog)),
      throwsA(isA<MosaicProtocolException>()),
    );
  });

  test('consolidates Feature List and Timeline onto one marker union', () {
    final document = canonical();
    final features = node<MosaicFeatureListComponent>(document, 'features');
    expect(features.marker, isA<MosaicIconMarker>());
    expect(
        (features.marker as MosaicIconMarker).name, MosaicIconName.checkmark);

    // An absent item marker means the item carries the list's marker. It is
    // never a request for no glyph.
    final inherited = features.items.first;
    expect(inherited.marker, isNull);
    expect(inherited.resolveMarker(features.marker), same(features.marker));

    // The negated case a 0.3 list could not express.
    final negated =
        features.items.firstWhere((item) => item.id == 'offline-ready');
    final override = negated.resolveMarker(features.marker);
    expect(override, isA<MosaicIconMarker>());
    expect((override as MosaicIconMarker).name, MosaicIconName.close);

    expect(
      features.items.firstWhere((item) => item.id == 'native-rendering').marker,
      isA<MosaicOrdinalMarker>(),
    );

    // Timeline reads the same union, so the two idioms cannot drift apart.
    final timeline = node<MosaicTimelineComponent>(document, 'trial-timeline');
    expect(timeline.entries.first.marker, isA<MosaicDotMarker>());
  });

  test('a 0.3 Feature List keeps its single checkmark constant', () {
    final document = const MosaicProtocolDecoder().decode(
      canonicalFixtureSource(),
    );
    final features = node<MosaicFeatureListComponent>(document, 'features');
    // The 0.3 constant means exactly the checkmark arm of the 0.4 union, so
    // both versions read through one field and one renderer.
    expect(
        (features.marker as MosaicIconMarker).name, MosaicIconName.checkmark);
    expect(features.items.every((item) => item.marker == null), isTrue);
  });

  test('0.4 removes style.productCardStates and adds the motion tier', () {
    expect(
      mosaicProtocolV04Capabilities,
      isNot(contains('style.productCardStates')),
    );
    expect(mosaicProtocolV03Capabilities, contains('style.productCardStates'));
    expect(
        mosaicProtocolV04Capabilities, containsAll(mosaicMotionCapabilities));
    expect(
      mosaicProtocolV04Capabilities.difference(mosaicProtocolV03Capabilities),
      mosaicMotionCapabilities,
    );

    // The canonical document derives exactly the capabilities it declares, so
    // the derivation and the fixture check each other.
    final document = canonical();
    expect(
      document.compatibility.requiredCapabilities.map((c) => c.name).toSet(),
      containsAll(mosaicMotionCapabilities),
    );
    expect(
      document.compatibility.requiredCapabilities.map((c) => c.version),
      everyElement('0.4'),
    );

    final declared =
        jsonDecode(fixture('complete-paywall.json'))! as Map<String, Object?>;
    (((declared['compatibility']!
            as Map<String, Object?>)['requiredCapabilities']!) as List<Object?>)
        .add(<String, Object?>{
      'name': 'style.productCardStates',
      'version': '0.4',
    });
    expect(
      () => const MosaicProtocolDecoder().decode(jsonEncode(declared)),
      throwsA(
        isA<MosaicProtocolException>().having(
          (error) => error.rejection,
          'rejection',
          MosaicProtocolRejection.unsupportedCapability,
        ),
      ),
    );
  });

  test('a document may not claim motion it does not author', () {
    // The existing unused-capability rule is what protects the enhancement
    // tier: a reader that renders statically must not be told motion is present
    // when none is.
    final source =
        jsonDecode(fixture('navigation-only.json'))! as Map<String, Object?>;
    (((source['compatibility']!
            as Map<String, Object?>)['requiredCapabilities']!) as List<Object?>)
        .add(<String, Object?>{'name': 'motion.loop', 'version': '0.4'});
    expect(
      () => const MosaicProtocolDecoder().decode(jsonEncode(source)),
      throwsA(isA<MosaicProtocolException>()),
    );
  });
}

Map<String, Object?> _find(Map<String, Object?> document, String id) {
  Map<String, Object?>? visit(Map<String, Object?> node) {
    if (node['id'] == id) return node;
    for (final key in const <String>['content', 'children', 'tabs', 'pages']) {
      final value = node[key];
      if (value is Map<String, Object?>) {
        final found = visit(value);
        if (found != null) return found;
      } else if (value is List<Object?>) {
        for (final child in value.cast<Map<String, Object?>>()) {
          final found = visit(child);
          if (found != null) return found;
        }
      }
    }
    return null;
  }

  for (final screen
      in (document['screens']! as List<Object?>).cast<Map<String, Object?>>()) {
    final found = visit(screen['layout']! as Map<String, Object?>);
    if (found != null) return found;
  }
  fail('fixture has no node $id');
}
