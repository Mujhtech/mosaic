import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:mosaic_sdk/mosaic_sdk.dart';

import 'support/canonical_fixture.dart';

/// The motion vocabulary and the consolidated marker union.
///
/// General decoding rules live in `protocol_test.dart`; what is tested here is
/// the motion tier, its safety rejections, and the marker union both Feature
/// List and Timeline read through.
void main() {
  String fixture(String name) =>
      repositoryFile('protocol/fixtures/v0.4/$name').readAsStringSync();

  MosaicPaywallDocument canonical() =>
      const MosaicProtocolDecoder().decode(fixture('complete-paywall.json'));

  T node<T extends MosaicNode>(MosaicPaywallDocument document, String id) =>
      document.nodes.whereType<T>().firstWhere((node) => node.id == id);

  test('a motion-only design system does not derive style.designTokens', () {
    // `style.designTokens` is derived from the colour, background, and shadow
    // catalogs only. Widening it to motions would reject a valid canonical
    // document
    // as configuration-unavailable, which is the worst failure mode a reader
    // has: the paywall is well-formed and the customer sees nothing.
    final document = const MosaicProtocolDecoder().decode(
      fixture('screen-round-trip.json'),
    );
    final designSystem = document.designSystem!;
    expect(designSystem.motions, isNotEmpty);
    expect(designSystem.colors, isEmpty);
    expect(designSystem.backgrounds, isEmpty);
    expect(designSystem.shadows, isEmpty);

    final declared =
        document.compatibility.requiredCapabilities.map((c) => c.name).toSet();
    expect(declared, isNot(contains('style.designTokens')));
    // The motion capabilities are derived at the reference site instead.
    expect(declared, containsAll(<String>{'motion.appear', 'motion.loop'}));
  });

  test('motion token usage is reachability from node reference sites', () {
    // The transitive fixture is rejected either way, because its orphaned
    // alias has nothing pointing at it. What separates the two readings is
    // *which* token is named, and the catalog order is what exposes it: with
    // the target declared first, a validator that treats the catalog as its
    // own usage root sees the alias vouch for the target and walks past it.
    // Usage is reachability from a node, so both orphans are unused and the
    // first one in the catalog is the one reported.
    final source = jsonDecode(fixture('invalid/unused-token-transitive.json'))!
        as Map<String, Object?>;
    final motions = (source['designSystem']!
        as Map<String, Object?>)['motions']! as List<Object?>;
    final alias = motions.removeAt(motions.length - 2);
    expect((alias as Map<String, Object?>)['id'], 'motion-orphan-a');
    expect((motions.last! as Map<String, Object?>)['id'], 'motion-orphan-b');
    motions.add(alias);

    expect(
      () => const MosaicProtocolDecoder().decode(jsonEncode(source)),
      throwsA(
        isA<MosaicProtocolException>().having(
          (error) => error.message,
          'message',
          contains('motion-orphan-b'),
        ),
      ),
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

    // A per-item override that negates the list's own glyph.
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

  test(
      'the vocabulary drops style.productCardStates and carries the motion '
      'tier', () {
    // `style.productCardStates` was derived exactly when one of the three
    // components that require `styles` was derived, so it carried no
    // information. Declaring it is an unknown capability, not a no-op.
    expect(
      mosaicProtocolCapabilities,
      isNot(contains('style.productCardStates')),
    );
    expect(mosaicProtocolCapabilities, containsAll(mosaicMotionCapabilities));

    // The canonical document derives exactly the capabilities it declares, so
    // the derivation and the fixture check each other.
    final document = canonical();
    expect(
      document.compatibility.requiredCapabilities.map((c) => c.name).toSet(),
      containsAll(mosaicMotionCapabilities),
    );
    expect(
      document.compatibility.requiredCapabilities.map((c) => c.version),
      everyElement(mosaicProtocolVersion),
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
